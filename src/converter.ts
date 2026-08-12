import { parseStylesheet, type ParsedDecl, type AtRuleContext } from './css-parser.ts'
import type { DesignSystem } from './design-system.ts'
import { toOklab, oklabDistance } from './color.ts'
import { declKey, isColorValue, resolveClassDecls, type ReverseIndex } from './reverse-index.ts'
import { normalizeLength } from './normalize.ts'
import { createColorMatcher, type ColorMatcher } from './matchers/color.ts'
import { matchSpacing } from './matchers/spacing.ts'
import { arbitraryUtility, arbitraryProperty } from './matchers/arbitrary.ts'
import { expandBoxShorthand } from './matchers/shorthand.ts'
import { selectorVariants, mediaVariant, type VariantContext } from './variants.ts'
import type { ConverterOptions, ConvertResult, ConvertedNode } from './types.ts'

/** A loaded system. `ds` is present only on the live (custom-theme) path. */
interface LoadedSystem {
  ds?: DesignSystem
  index: ReverseIndex
  colorMatcher: ColorMatcher
  breakpoints: Map<string, string>
}

const systemCache = new Map<string, Promise<LoadedSystem>>()

function breakpointsFrom(index: ReverseIndex, remInPx: number): Map<string, string> {
  const bp = new Map<string, string>()
  for (const [name, value] of index.vars) {
    if (name.startsWith('--breakpoint-')) {
      const rem = normalizeLength(value, remInPx)
      if (rem) bp.set(rem, name.slice('--breakpoint-'.length))
    }
  }
  return bp
}

function finalizeSystem(system: Omit<LoadedSystem, 'colorMatcher' | 'breakpoints'>, remInPx: number): LoadedSystem {
  return {
    ...system,
    colorMatcher: createColorMatcher(system.index.palette),
    breakpoints: breakpointsFrom(system.index, remInPx),
  }
}

interface SystemOptions {
  css?: string
  base?: string
  theme?: string
  remInPx: number
}

function loadSystem({ css, base, theme, remInPx }: SystemOptions): Promise<LoadedSystem> {
  const key = `${base ?? ''}|${remInPx}|${theme ?? ''}|${css ?? ''}`
  let cached = systemCache.get(key)
  if (!cached) {
    // `css`/`base` need the Tailwind engine (Node only) — dynamically imported so
    // the stock/`theme` paths never pull `tailwindcss`/`node:fs` into an edge
    // bundle. Stock and custom-`theme` use the engine-free embedded index.
    cached =
      css !== undefined || base !== undefined
        ? (async () => {
            const [{ loadDesignSystem }, { buildReverseIndex }] = await Promise.all([
              import('./design-system.ts'),
              import('./reverse-index.ts'),
            ])
            const ds = await loadDesignSystem(css, base)
            return finalizeSystem({ ds, index: buildReverseIndex(ds, remInPx) }, remInPx)
          })()
        : import('./embedded.ts').then((m) =>
            finalizeSystem(
              { index: theme ? m.loadThemeIndex(theme, remInPx) : m.loadEmbeddedIndex(remInPx) },
              remInPx,
            ),
          )
    systemCache.set(key, cached)
  }
  return cached
}

export class CssToTailwind {
  private options: Required<Omit<ConverterOptions, 'css' | 'base' | 'theme'>> &
    Pick<ConverterOptions, 'css' | 'base' | 'theme'>
  private ds?: DesignSystem
  private index?: ReverseIndex
  private colorMatcher?: ColorMatcher
  private variantCtx?: VariantContext
  /** Memoized declaration conversions (`prop|value` -> class list, empty if none). */
  private declCache = new Map<string, string[]>()

  constructor(options: ConverterOptions = {}) {
    this.options = {
      remInPx: options.remInPx ?? 16,
      arbitrary: options.arbitrary ?? true,
      colorThreshold: options.colorThreshold ?? 0.02,
      canonicalize: options.canonicalize ?? true,
      theme: options.theme,
      css: options.css,
      base: options.base,
    }
  }

  /** Loads the reverse index (embedded or live), idempotent + cached. */
  private async init(): Promise<void> {
    if (this.index) return
    const sys = await loadSystem(this.options)
    this.ds = sys.ds
    this.index = sys.index
    this.colorMatcher = sys.colorMatcher
    this.variantCtx = { breakpoints: sys.breakpoints, remInPx: this.options.remInPx }
  }

  /** Converts a CSS string into Tailwind utilities, grouped per selector. */
  async convert(css: string): Promise<ConvertResult> {
    await this.init()
    const nodes: ConvertedNode[] = []
    for (const rule of parseStylesheet(css)) {
      const media = this.atRuleVariants(rule.atRules)
      for (const selector of rule.selectors) {
        const node = this.convertRule(rule.decls, selector, media)
        if (node) nodes.push(node)
      }
    }
    return { nodes }
  }

  /** Maps a rule's at-rule context into variant prefixes, or null if unsupported. */
  private atRuleVariants(atRules: AtRuleContext[]): string[] | null {
    const variants: string[] = []
    for (const at of atRules) {
      if (at.name === 'media') {
        const v = mediaVariant(at.params, this.variantCtx!)
        if (!v) return null
        variants.push(v)
      } else if (at.name === 'supports') {
        // `(display: grid)` -> `supports-[display:grid]`; strip one wrapping paren pair.
        let feat = at.params.replace(/\s+/g, '')
        if (feat.startsWith('(') && feat.endsWith(')')) feat = feat.slice(1, -1)
        variants.push(`supports-[${feat}]`)
      } else {
        return null
      }
    }
    return variants
  }

  private convertRule(decls: ParsedDecl[], selector: string, media: string[] | null): ConvertedNode | null {
    const { base, variants: pseudoVariants } = selectorVariants(selector)
    const classes: string[] = []
    const complementary: string[] = []

    for (const decl of decls) {
      // If the rule sits under an unsupported at-rule, nothing is convertible.
      const cls = media === null ? [] : this.convertDeclaration(decl.prop.toLowerCase(), decl.value)
      if (cls.length) classes.push(...cls)
      else complementary.push(stringifyDecl(decl))
    }

    if (classes.length === 0 && complementary.length === 0) return null

    const prefix = [...(media ?? []), ...pseudoVariants].map((v) => `${v}:`).join('')
    const prefixed = prefix ? classes.map((c) => applyVariantPrefix(prefix, c)) : classes
    const ordered = this.orderClasses(prefixed)

    return {
      selector: base || selector,
      tailwindClasses: ordered,
      complementary: complementary.join('; '),
    }
  }

  /** Converts a declaration to utility class(es), memoized per (prop, value). */
  private convertDeclaration(prop: string, value: string): string[] {
    const trimmed = value.trim()
    const cacheKey = `${prop}|${trimmed}`
    const cached = this.declCache.get(cacheKey)
    if (cached !== undefined) return cached
    const result = this.convertDeclarationUncached(prop, trimmed)
    this.declCache.set(cacheKey, result)
    return result
  }

  private convertDeclarationUncached(prop: string, trimmed: string): string[] {
    // `text-decoration` is a shorthand; its single-keyword form maps to the
    // `text-decoration-line` utility (`none` -> `no-underline`, `underline`).
    if (prop === 'text-decoration' && !/\s/.test(trimmed)) {
      const cls = this.convertSingle('text-decoration-line', trimmed)
      if (cls) return [cls]
    }

    // Multi-value `padding`/`margin` shorthands split into axis utilities
    // (`padding: 0 24px` -> `py-0 px-6`). Falls through if any part can't convert.
    const box = expandBoxShorthand(prop, trimmed)
    if (box) {
      const out: string[] = []
      let ok = true
      for (const part of box) {
        const cls = this.convertSingle(part.prop, part.value)
        if (!cls) { ok = false; break }
        out.push(cls)
      }
      if (ok) return out
    }
    const single = this.convertSingle(prop, trimmed)
    return single ? [single] : []
  }

  private convertSingle(prop: string, trimmed: string): string | null {
    const index = this.index!

    if (isColorValue(trimmed)) {
      const root = index.colorRoots.get(prop)
      if (!root) return this.arbitraryFor(prop, trimmed)
      const named = this.colorMatcher!.match(root, trimmed, this.options.colorThreshold)
      if (named && this.verify(named, prop, trimmed)) return named
      return this.arbitraryUtilityFor(root, prop, trimmed)
    }

    // Font-size maps to the `--text-*` scale (`20px` -> `text-xl`). Like v3, we
    // accept the named size even though it also carries a default line-height.
    if (prop === 'font-size') {
      const rem = normalizeLength(trimmed, this.options.remInPx)
      const token = rem ? index.textSizes.get(rem) : undefined
      if (token && this.verifyProducesFontSize(`text-${token}`, trimmed)) return `text-${token}`
    }

    // Exact reverse-index match. These entries were built by rendering the class
    // through Tailwind, so they're ground-truth — no need to re-verify.
    const exact = index.decls.get(declKey(prop, trimmed, this.options.remInPx))
    if (exact) return exact

    const root = index.propToRoot.get(prop)
    if (root && index.spacingRoots.has(root)) {
      const spaced = matchSpacing(root, trimmed, index.spacingBaseRem, this.options.remInPx)
      if (spaced && this.verify(spaced, prop, trimmed)) return spaced
    }
    if (root) return this.arbitraryUtilityFor(root, prop, trimmed)
    return this.arbitraryFor(prop, trimmed)
  }

  private arbitraryUtilityFor(root: string, prop: string, value: string): string | null {
    if (!this.options.arbitrary) return null
    // Prefer a named functional utility for bare-number values (`z-index: 60` ->
    // `z-60`, `order: 13` -> `order-13`), gated by the set of numeric roots so we
    // never emit an invalid class (works without the engine).
    if (this.options.canonicalize && /^\d+$/.test(value) && this.index!.numericRoots.has(root)) {
      const named = `${root}-${value}`
      if (this.verify(named, prop, value)) return named
    }
    const candidate = arbitraryUtility(root, value)
    if (this.verify(candidate, prop, value)) return candidate
    return this.arbitraryFor(prop, value)
  }

  private arbitraryFor(prop: string, value: string): string | null {
    if (!this.options.arbitrary) return null
    const candidate = arbitraryProperty(prop, value)
    return this.verify(candidate, prop, value) ? candidate : null
  }

  /**
   * Confirms a class produces exactly the input declaration. On the embedded
   * (engine-free) path there's nothing to render against, so we trust the
   * pre-verified index + deterministic matchers.
   */
  private verify(className: string, prop: string, value: string): boolean {
    if (!this.ds) return true
    const decls = resolveClassDecls(this.ds, className, this.index!.vars)
    if (!decls || decls.length !== 1) return false
    const only = decls[0]
    return only.prop === prop && this.valueEquals(prop, only.value, value)
  }

  /**
   * Confirms a class sets the given font-size (ignoring any companion line-height
   * the size utility also carries — mirrors css-to-tailwindcss's behavior).
   */
  private verifyProducesFontSize(className: string, value: string): boolean {
    if (!this.ds) return true // trust the theme-derived text-size scale
    const decls = resolveClassDecls(this.ds, className, this.index!.vars)
    const fs = decls?.find((d) => d.prop === 'font-size')
    return fs ? this.valueEquals('font-size', fs.value, value) : false
  }

  /** Compares two declaration values (colors by ΔE, lengths/keywords canonically). */
  private valueEquals(prop: string, a: string, b: string): boolean {
    if (isColorValue(b)) {
      const ca = toOklab(a)
      const cb = toOklab(b)
      if (!ca || !cb) return a.trim().toLowerCase() === b.trim().toLowerCase()
      return oklabDistance(ca, cb) <= Math.max(this.options.colorThreshold, 1e-4)
    }
    return declKey(prop, a, this.options.remInPx) === declKey(prop, b, this.options.remInPx)
  }

  /**
   * Sorts classes into Tailwind's class order using the embedded root-rank table
   * (no engine). Classes with an unknown root sort last, preserving input order.
   */
  private orderClasses(classes: string[]): string[] {
    const ranks = this.index!.rootRanks
    return classes
      .map((className, i) => ({ className, rank: ranks.get(this.orderKey(className)) ?? Infinity, i }))
      .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.i - b.i))
      .map((e) => e.className)
  }

  /** Reduces a class to its ordering key (root or static-class name). */
  private orderKey(className: string): string {
    let base = stripVariants(className)
    if (base.startsWith('-')) base = base.slice(1)
    const parts = base.split('-')
    for (let n = parts.length; n >= 1; n--) {
      const key = parts.slice(0, n).join('-')
      if (this.index!.rootRanks.has(key)) return key
    }
    return base
  }
}

/** Strips variant prefixes (`md:hover:`) that sit outside bracketed values. */
function stripVariants(className: string): string {
  let depth = 0
  let lastColon = -1
  for (let i = 0; i < className.length; i++) {
    const c = className[i]
    if (c === '[' || c === '(') depth++
    else if (c === ']' || c === ')') depth--
    else if (c === ':' && depth === 0) lastColon = i
  }
  return className.slice(lastColon + 1)
}

function stringifyDecl(decl: ParsedDecl): string {
  return `${decl.prop}: ${decl.value}${decl.important ? ' !important' : ''}`
}

function applyVariantPrefix(prefix: string, className: string): string {
  // Negative utilities keep the leading `-` outermost: `md:-mt-4`.
  if (className.startsWith('-')) return `${prefix}-${className.slice(1)}`
  return `${prefix}${className}`
}
