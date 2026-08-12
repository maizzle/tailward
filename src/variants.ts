import { normalizeLength } from './normalize.ts'

export interface VariantContext {
  /** rem value (e.g. `48rem`) -> breakpoint token (`md`). */
  breakpoints: Map<string, string>
  remInPx: number
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

const MEDIA_FEATURE_VARIANTS: Record<string, string> = {
  'prefers-color-scheme:dark': 'dark',
  'prefers-reduced-motion:reduce': 'motion-reduce',
  'prefers-reduced-motion:no-preference': 'motion-safe',
  'prefers-contrast:more': 'contrast-more',
  'prefers-contrast:less': 'contrast-less',
  'orientation:portrait': 'portrait',
  'orientation:landscape': 'landscape',
  'forced-colors:active': 'forced-colors',
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

/** Maps an `@media` params string to a Tailwind variant, or null if unsupported. */
export function mediaVariant(params: string, ctx: VariantContext): string | null {
  const norm = params.replace(/\s+/g, '').replace(/^screenand/, '').replace(/^screen/, '')

  if (norm === 'print') return 'print'

  const feature = norm.replace(/^\(/, '').replace(/\)$/, '')
  if (MEDIA_FEATURE_VARIANTS[feature]) return MEDIA_FEATURE_VARIANTS[feature]

  const min = /\(min-width:([^)]+)\)/.exec(norm)
  if (min && !norm.includes('max-width')) {
    const rem = normalizeLength(min[1], ctx.remInPx)
    const token = rem && ctx.breakpoints.get(rem)
    return token ?? `min-[${min[1]}]`
  }

  const max = /\(max-width:([^)]+)\)/.exec(norm)
  if (max && !norm.includes('min-width')) {
    // Tailwind's max-* breakpoints target one step below a named token; emit the
    // arbitrary form to stay correct rather than guessing the named token.
    return `max-[${max[1]}]`
  }

  return null
}
