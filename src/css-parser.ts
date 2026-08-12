/**
 * Tiny CSS parser for the converter's input. Replaces postcss-safe-parser, which
 * costs ~15ms just to import — dominating cold start. We only need flat rules with
 * their declarations and at-rule (media/supports) context, so a focused tokenizer
 * is enough (and far cheaper).
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
}

type Segment = { kind: 'decl'; text: string } | { kind: 'block'; prelude: string; body: string }

/** Removes `/* *\/` comments, ignoring `/*` inside strings. */
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
      i = end === -1 ? css.length : end + 1
    } else {
      out += c
    }
  }
  return out
}

/** Splits a block into declarations (`a: b`) and nested blocks (`sel { ... }`). */
function segments(block: string): Segment[] {
  const out: Segment[] = []
  let depth = 0
  let quote = ''
  let start = 0
  for (let i = 0; i < block.length; i++) {
    const c = block[i]
    if (quote) {
      if (c === quote && block[i - 1] !== '\\') quote = ''
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (depth === 0 && c === '{') {
      const prelude = block.slice(start, i)
      const close = matchBrace(block, i)
      out.push({ kind: 'block', prelude, body: block.slice(i + 1, close) })
      i = close
      start = i + 1
    } else if (depth === 0 && c === ';') {
      out.push({ kind: 'decl', text: block.slice(start, i) })
      start = i + 1
    }
  }
  const tail = block.slice(start).trim()
  if (tail) out.push({ kind: 'decl', text: tail })
  return out
}

function matchBrace(s: string, open: number): number {
  let depth = 0
  let quote = ''
  for (let i = open; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === quote && s[i - 1] !== '\\') quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i
  }
  return s.length
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

function walk(block: string, atRules: AtRuleContext[], out: ParsedRule[]): void {
  const loose: ParsedDecl[] = []
  for (const seg of segments(block)) {
    if (seg.kind === 'decl') {
      const decl = parseDecl(seg.text)
      if (decl) loose.push(decl)
      continue
    }
    const prelude = seg.prelude.trim()
    if (prelude.startsWith('@')) {
      const sp = prelude.search(/\s/)
      const name = (sp === -1 ? prelude : prelude.slice(0, sp)).slice(1)
      const params = sp === -1 ? '' : prelude.slice(sp).trim()
      walk(seg.body, [...atRules, { name, params }], out)
    } else {
      const decls: ParsedDecl[] = []
      for (const inner of segments(seg.body)) {
        if (inner.kind === 'decl') {
          const decl = parseDecl(inner.text)
          if (decl) decls.push(decl)
        }
      }
      out.push({ selectors: splitSelectors(prelude), decls, atRules })
    }
  }
  // Bare declarations (an inline-style list with no selector).
  if (loose.length) out.push({ selectors: [''], decls: loose, atRules })
}

/** Parses CSS into a flat list of rules with their at-rule context. */
export function parseStylesheet(css: string): ParsedRule[] {
  const out: ParsedRule[] = []
  walk(stripComments(css), [], out)
  return out
}
