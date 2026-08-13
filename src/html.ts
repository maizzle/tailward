/**
 * HTML de-inliner: rewrites inline `style=""` attributes and `<style>` rules into
 * Tailwind utility classes. Lives in its own module (subpath `tailward/html`) so
 * the core `convert` entry stays free of the HTML parsing deps for edge bundles.
 */
import { parseDocument } from 'htmlparser2'
import render from 'dom-serializer'
import { selectAll } from 'css-select'
import { removeElement, textContent } from 'domutils'
import { Text, type Document, type Element } from 'domhandler'
import { CssToTailwind } from './converter.ts'
import { parseStylesheet, type AtRuleContext, type ParsedDecl } from './css-parser.ts'
import type { ConvertedNode, ConverterOptions, Warning } from './types.ts'

export interface ConvertHtmlOptions extends ConverterOptions {
  /** Rewrite inline `style=""` attributes into classes. @default true */
  inline?: boolean
  /**
   * How to treat `<style>` rules:
   * - `variants` (default): attach converted classes to matching elements (baking
   *   `@media`/`:hover` into `sm:`/`hover:` variants); keep the rest as a residual `<style>`.
   * - `residual`: leave every `<style>` block untouched (only inline attributes are converted).
   * - `drop`: convert what maps and discard everything else (no residual `<style>`).
   * @default 'variants'
   */
  styleRules?: 'variants' | 'residual' | 'drop'
  /** Keep the original `style=""` attribute alongside the emitted classes. @default false */
  keepStyleAttr?: boolean
}

export interface ConvertHtmlResult {
  html: string
  warnings: Warning[]
}

/** Serializes a declaration back to CSS text. */
function declText(d: ParsedDecl): string {
  return `${d.prop}: ${d.value}${d.important ? ' !important' : ''}`
}

/** Reconstructs a single rule as CSS, re-wrapping its at-rule context. */
function ruleToCss(atRules: AtRuleContext[], selector: string, decls: ParsedDecl[]): string {
  const inner = decls.map(declText).join('; ')
  let css = selector.trim() ? `${selector} { ${inner} }` : `${inner};`
  for (let i = atRules.length - 1; i >= 0; i--) {
    const at = atRules[i]
    css = `@${at.name}${at.params ? ` ${at.params}` : ''} { ${css} }`
  }
  return css
}

/** Finds the index of the `}` closing the `{` at `open`, respecting quotes/nesting. */
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

/** A top-level chunk of a stylesheet: an at-rule name (if any) plus its raw source. */
interface TopBlock {
  atName: string | null
  raw: string
}

/**
 * Splits a stylesheet into top-level blocks without flattening. Unlike the flat
 * parser, this preserves whole at-rule blocks verbatim (so `@keyframes`/`@font-face`
 * survive round-tripping intact) while still exposing plain and `@media`/`@supports`
 * rules for conversion.
 */
function topLevelBlocks(css: string): TopBlock[] {
  const out: TopBlock[] = []
  let quote = ''
  let start = 0
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (quote) {
      if (c === quote && css[i - 1] !== '\\') quote = ''
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '{') {
      // `matchBrace` skips nested braces, so a top-level `{` is always a block open.
      const close = matchBrace(css, i)
      const prelude = css.slice(start, i).trim()
      const raw = css.slice(start, close + 1).trim()
      const at = /^@([a-z-]+)/i.exec(prelude)
      if (raw) out.push({ atName: at ? at[1].toLowerCase() : null, raw })
      i = close
      start = i + 1
    } else if (c === ';') {
      // A top-level `;` ends a block-less statement (`@import`, `@charset`); keep
      // at-statements verbatim and reset so they don't bleed into the next prelude.
      const stmt = css.slice(start, i).trim()
      const at = /^@([a-z-]+)/i.exec(stmt)
      if (at) out.push({ atName: at[1].toLowerCase(), raw: `${stmt};` })
      start = i + 1
    }
  }
  return out
}

/** At-rules `convert` can fold into variants; anything else is preserved verbatim. */
const CONVERTIBLE_AT_RULES = new Set(['media', 'supports'])

/** Adds classes to an element's `class` attribute, de-duplicating. */
function addClasses(el: Element, classes: string[]): void {
  const merged = (el.attribs.class ?? '').split(/\s+/).filter(Boolean)
  for (const c of classes) if (!merged.includes(c)) merged.push(c)
  el.attribs.class = merged.join(' ')
}

/** Replaces a `<style>` element's contents with new CSS text (or removes it if empty). */
function setStyleContent(el: Element, css: string): void {
  if (!css) {
    removeElement(el)
    return
  }
  const text = new Text(css)
  text.parent = el
  el.children = [text]
}

/**
 * Converts a full HTML document: inline `style=""` attributes and (by default)
 * `<style>` rules become Tailwind utility classes. Returns the rewritten HTML and
 * any conversion warnings.
 */
export async function convertHtml(
  html: string,
  options: ConvertHtmlOptions = {},
): Promise<ConvertHtmlResult> {
  const { inline = true, styleRules = 'variants', keepStyleAttr = false, ...converterOptions } = options
  const converter = new CssToTailwind(converterOptions)
  const warnings: Warning[] = []
  // Parse and serialize without touching entities so text/attributes round-trip
  // byte-for-byte (`&amp;` stays `&amp;`, `café` stays `café`).
  const doc: Document = parseDocument(html, { decodeEntities: false })

  if (styleRules !== 'residual') {
    for (const styleEl of selectAll('style', doc) as unknown as Element[]) {
      const residual = await convertStyleBlock(converter, doc, textContent(styleEl), styleRules, warnings)
      setStyleContent(styleEl, residual)
    }
  }

  if (inline) {
    for (const el of selectAll('[style]', doc) as unknown as Element[]) {
      const style = el.attribs.style
      if (!style) continue
      const { nodes, warnings: w } = await converter.convert(style)
      warnings.push(...w)
      const node = nodes[0]
      if (!node) continue
      if (node.tailwindClasses.length) addClasses(el, node.tailwindClasses)
      if (keepStyleAttr) continue
      if (node.complementary) el.attribs.style = node.complementary
      else delete el.attribs.style
    }
  }

  return { html: render(doc, { encodeEntities: false }), warnings }
}

/** Converts one `<style>` block against the document, returning leftover residual CSS. */
async function convertStyleBlock(
  converter: CssToTailwind,
  doc: Document,
  css: string,
  styleRules: 'variants' | 'drop',
  warnings: Warning[],
): Promise<string> {
  const residual: string[] = []
  const keep = (snippet: string) => {
    if (styleRules !== 'drop') residual.push(snippet)
  }

  for (const block of topLevelBlocks(css)) {
    // Preserve at-rules we can't fold into variants (`@keyframes`, `@font-face`, ...) verbatim.
    if (block.atName && !CONVERTIBLE_AT_RULES.has(block.atName)) {
      keep(block.raw)
      continue
    }
    for (const rule of parseStylesheet(block.raw)) {
      for (const selector of rule.selectors) {
        if (!selector.trim()) {
          keep(ruleToCss(rule.atRules, selector, rule.decls))
          continue
        }
        const snippet = ruleToCss(rule.atRules, selector, rule.decls)
        const { nodes, warnings: w } = await converter.convert(snippet)
        warnings.push(...w)
        const node = nodes[0]
        if (!attachRule(doc, node)) keep(snippet)
      }
    }
  }
  return residual.join('\n')
}

/** Attaches a fully-converted rule's classes to matching elements. Returns false if it couldn't. */
function attachRule(doc: Document, node: ConvertedNode | undefined): boolean {
  if (!node || !node.tailwindClasses.length || node.complementary) return false
  let targets: Element[]
  try {
    targets = selectAll(node.selector, doc) as unknown as Element[]
  } catch {
    return false
  }
  if (!targets.length) return false
  for (const t of targets) addClasses(t, node.tailwindClasses)
  return true
}
