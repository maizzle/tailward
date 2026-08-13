/**
 * Tiny CSS parser for the converter's input. Replaces postcss-safe-parser, which
 * costs ~15ms just to import — dominating cold start. We only need flat rules with
 * their declarations and at-rule (media/supports) context, so a focused tokenizer
 * is enough (and far cheaper).
 *
 * The parser works over absolute offsets into the (comment-stripped) source so each
 * rule can report where it came from. Comment stripping preserves length and
 * newlines, so those offsets map straight back onto the original string.
 */

export interface ParsedDecl {
  prop: string
  value: string
  important: boolean
}

export interface AtRuleContext {
  name: string
  params: string
}

export interface ParsedRule {
  selectors: string[]
  decls: ParsedDecl[]
  /** Enclosing at-rules, outermost first. */
  atRules: AtRuleContext[]
  /** Char offset of the rule's start (its prelude) in the source. */
  start: number
  /** Char offset just past the rule's closing brace. */
  end: number
}

type Segment =
  | { kind: 'decl'; start: number; end: number }
  | { kind: 'block'; preludeStart: number; brace: number; bodyStart: number; bodyEnd: number; end: number }

/** Blanks out `/* *\/` comments in place (ignoring `/*` in strings), preserving length + newlines. */
function stripComments(css: string): string {
  let out = ''
  let quote = ''
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (quote) {
      out += c
      if (c === quote && css[i - 1] !== '\\') quote = ''
    } else if (c === '"' || c === "'") {
      quote = c
      out += c
    } else if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      const stop = end === -1 ? css.length : end + 2
      for (; i < stop; i++) out += css[i] === '\n' ? '\n' : ' '
      i-- // the for-loop's i++ will re-advance past `stop`
    } else {
      out += c
    }
  }
  return out
}

/** Splits `css[from, to)` into declarations and nested blocks, tracking absolute offsets. */
function segments(css: string, from: number, to: number): Segment[] {
  const out: Segment[] = []
  let depth = 0
  let quote = ''
  let start = from
  for (let i = from; i < to; i++) {
    const c = css[i]
    if (quote) {
      if (c === quote && css[i - 1] !== '\\') quote = ''
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (depth === 0 && c === '{') {
      const close = matchBrace(css, i, to)
      out.push({ kind: 'block', preludeStart: start, brace: i, bodyStart: i + 1, bodyEnd: close, end: Math.min(close + 1, to) })
      i = close
      start = i + 1
    } else if (depth === 0 && c === ';') {
      out.push({ kind: 'decl', start, end: i })
      start = i + 1
    }
  }
  if (start < to && css.slice(start, to).trim()) out.push({ kind: 'decl', start, end: to })
  return out
}

function matchBrace(s: string, open: number, to: number): number {
  let depth = 0
  let quote = ''
  for (let i = open; i < to; i++) {
    const c = s[i]
    if (quote) {
      if (c === quote && s[i - 1] !== '\\') quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i
  }
  return to
}

/** Splits a selector list on top-level commas (ignoring `:not(a, b)`). */
function splitSelectors(prelude: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < prelude.length; i++) {
    const c = prelude[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) {
      parts.push(prelude.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(prelude.slice(start).trim())
  return parts.filter(Boolean)
}

function parseDecl(text: string): ParsedDecl | null {
  const colon = text.indexOf(':')
  if (colon === -1) return null
  const prop = text.slice(0, colon).trim()
  if (!prop) return null
  let value = text.slice(colon + 1).trim()
  let important = false
  const bang = value.toLowerCase().lastIndexOf('!important')
  if (bang !== -1) {
    important = true
    value = value.slice(0, bang).trim()
  }
  return { prop, value, important }
}

/** Advances past leading whitespace so a rule's span starts at its first real character. */
function skipSpace(css: string, from: number, to: number): number {
  let i = from
  while (i < to && /\s/.test(css[i])) i++
  return i
}

function walk(css: string, from: number, to: number, atRules: AtRuleContext[], out: ParsedRule[]): void {
  const loose: ParsedDecl[] = []
  for (const seg of segments(css, from, to)) {
    if (seg.kind === 'decl') {
      const decl = parseDecl(css.slice(seg.start, seg.end))
      if (decl) loose.push(decl)
      continue
    }
    const prelude = css.slice(seg.preludeStart, seg.brace).trim()
    if (prelude.startsWith('@')) {
      const sp = prelude.search(/\s/)
      const name = (sp === -1 ? prelude : prelude.slice(0, sp)).slice(1)
      const params = sp === -1 ? '' : prelude.slice(sp).trim()
      walk(css, seg.bodyStart, seg.bodyEnd, [...atRules, { name, params }], out)
    } else {
      const decls: ParsedDecl[] = []
      for (const inner of segments(css, seg.bodyStart, seg.bodyEnd)) {
        if (inner.kind === 'decl') {
          const decl = parseDecl(css.slice(inner.start, inner.end))
          if (decl) decls.push(decl)
        }
      }
      out.push({ selectors: splitSelectors(prelude), decls, atRules, start: skipSpace(css, seg.preludeStart, seg.brace), end: seg.end })
    }
  }
  // Bare declarations (an inline-style list with no selector).
  if (loose.length) out.push({ selectors: [''], decls: loose, atRules, start: skipSpace(css, from, to), end: to })
}

/** Parses CSS into a flat list of rules with their at-rule context and source span. */
export function parseStylesheet(css: string): ParsedRule[] {
  const out: ParsedRule[] = []
  walk(stripComments(css), 0, css.length, [], out)
  return out
}
