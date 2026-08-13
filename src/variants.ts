export interface VariantContext {
  /** Canonical media condition (`w<=430px`, `(prefers-color-scheme:dark)`) -> variant name. */
  mediaVariants: Map<string, string>
  remInPx: number
}

/** Normalizes a length token to whole pixels (`40rem` -> `640px`). */
function toPx(value: string, remInPx: number): string {
  const m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(value.trim())
  if (!m) return value.trim()
  const n = parseFloat(m[1]) * ((m[2] ?? 'px') === 'px' ? 1 : remInPx)
  return `${Math.round(n)}px`
}

/**
 * Canonicalizes a media condition so equivalent forms compare equal:
 * `min-width: 640px` and `width >= 40rem` both become `(w>=640px)`. Returns null
 * for compound/unparseable conditions (they fall back to a faithful arbitrary form).
 */
export function canonicalizeMedia(params: string, remInPx: number): string | null {
  const s = params
    .toLowerCase()
    .replace(/@media/g, ' ')
    .replace(/\bscreen\b/g, ' ')
    .replace(/\band\b/g, ' ')
    .replace(/\s+/g, '')
  if (!s) return null
  if (!s.includes('(')) return s // bare feature, e.g. `print`
  const width = (op: string, v: string) => `(w${op}${toPx(v, remInPx)})`
  return s
    .replace(/\(min-width:([^)]+)\)/g, (_, v) => width('>=', v))
    .replace(/\(max-width:([^)]+)\)/g, (_, v) => width('<=', v))
    .replace(/\(width>=([^)]+)\)/g, (_, v) => width('>=', v))
    .replace(/\(width<=([^)]+)\)/g, (_, v) => width('<=', v))
    .replace(/\(width<([^)]+)\)/g, (_, v) => width('<', v))
    .replace(/\(width>([^)]+)\)/g, (_, v) => width('>', v))
}

const PSEUDO_VARIANTS: Record<string, string> = {
  ':hover': 'hover',
  ':focus': 'focus',
  ':focus-within': 'focus-within',
  ':focus-visible': 'focus-visible',
  ':active': 'active',
  ':visited': 'visited',
  ':target': 'target',
  ':first-child': 'first',
  ':last-child': 'last',
  ':only-child': 'only',
  ':first-of-type': 'first-of-type',
  ':last-of-type': 'last-of-type',
  ':odd': 'odd',
  ':nth-child(odd)': 'odd',
  ':nth-child(even)': 'even',
  ':empty': 'empty',
  ':disabled': 'disabled',
  ':enabled': 'enabled',
  ':checked': 'checked',
  ':indeterminate': 'indeterminate',
  ':required': 'required',
  ':valid': 'valid',
  ':invalid': 'invalid',
  ':read-only': 'read-only',
  ':default': 'default',
  '::before': 'before',
  '::after': 'after',
  '::placeholder': 'placeholder',
  '::selection': 'selection',
  '::first-line': 'first-line',
  '::first-letter': 'first-letter',
  '::marker': 'marker',
  '::file-selector-button': 'file',
  '::backdrop': 'backdrop',
}

/** Splits a selector into its base (`.foo`) and an ordered list of pseudo variants. */
export function selectorVariants(selector: string): { base: string; variants: string[] } {
  const variants: string[] = []
  let base = selector
  // Strip trailing pseudo-classes/elements one at a time.
  let match: RegExpExecArray | null
  const pseudoRe = /(::?[a-z-]+(?:\([^)]*\))?)$/i
  while ((match = pseudoRe.exec(base))) {
    const pseudo = match[1].toLowerCase()
    const variant = PSEUDO_VARIANTS[pseudo]
    if (!variant) break
    variants.unshift(variant)
    base = base.slice(0, match.index)
  }
  return { base, variants }
}

/**
 * Maps an `@media` params string to a Tailwind variant.
 *
 * Prefers an exact named variant (`max-width: 430px` -> `xs`) by comparing
 * canonical conditions. Otherwise stays faithful: `min-width: N` -> `min-[N]`
 * (equivalent), and anything else -> a `[@media(…)]` arbitrary variant that
 * reproduces the query exactly — never `max-[N]`, whose `width < N` is NOT the
 * same query as `max-width: N` (`width <= N`).
 */
export function mediaVariant(params: string, ctx: VariantContext): string | null {
  const key = canonicalizeMedia(params, ctx.remInPx)
  if (key && ctx.mediaVariants.has(key)) return ctx.mediaVariants.get(key)!

  const bare = params
    .replace(/@media/gi, '')
    .replace(/\bscreen\b/gi, '')
    .replace(/\band\b/gi, ' ')
    .replace(/\s+/g, '')

  // `min-[N]` compiles to `width >= N`, exactly `min-width: N` — safe to use.
  const min = /^\(min-width:([^)]+)\)$/i.exec(bare)
  if (min) return `min-[${min[1]}]`

  // Faithful arbitrary variant for any other single condition (incl. max-width).
  if (bare.startsWith('(') && bare.endsWith(')')) return `[@media${bare}]`
  return null
}
