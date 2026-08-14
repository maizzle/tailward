import { parseStylesheet, type ParsedDecl, type AtRuleContext } from './css-parser.ts'
import type { DesignSystem } from './design-system.ts'
import { toOklab, oklabDistance } from './color.ts'
import { declKey, isColorValue, resolveClassDecls, type ReverseIndex } from './reverse-index.ts'
import { normalizeLength, absoluteLineHeight } from './normalize.ts'
import { createColorMatcher, type ColorMatcher } from './matchers/color.ts'
import { matchSpacing } from './matchers/spacing.ts'
import { arbitraryUtility, arbitraryProperty } from './matchers/arbitrary.ts'
import { expandBoxShorthand } from './matchers/shorthand.ts'
import { decomposeTransform, decomposeFilter, decomposeGradient, type FunctionsContext } from './matchers/functions.ts'
import { selectorVariants, mediaVariant, containerVariant, canonicalizeMedia, type VariantContext } from './variants.ts'
import type { ConversionSummary, ConverterOptions, ConvertResult, ConvertedNode, SourcePosition, Warning } from './types.ts'

/** A utility class carried through the pipeline with its importance flag. */
interface Cls {
  name: string
  important: boolean
}

/** A single-declaration conversion: the class plus an optional approximation note. */
interface SingleResult {
  cls: string
  note?: string
}

/** A full-declaration conversion (may expand to several classes). */
interface DeclResult {
  classes: string[]
  notes: string[]
}

/** A loaded system. `ds` is present only on the live (custom-theme) path. */
interface LoadedSystem {
  ds?: DesignSystem
  index: ReverseIndex
  colorMatcher: ColorMatcher
  mediaVariants: Map<string, string>
}

const systemCache = new Map<string, Promise<LoadedSystem>>()

function finalizeSystem(system: Omit<LoadedSystem, 'colorMatcher'>): LoadedSystem {
  return { ...system, colorMatcher: createColorMatcher(system.index.palette) }
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
            const [{ loadDesignSystem }, { buildReverseIndex, computeMediaVariants }] = await Promise.all([
              import('./design-system.ts'),
              import('./reverse-index.ts'),
            ])
            const ds = await loadDesignSystem(css, base)
            return finalizeSystem({
              ds,
              index: buildReverseIndex(ds, remInPx),
              mediaVariants: computeMediaVariants(ds, remInPx),
            })
          })()
        : import('./embedded.ts').then((m) =>
            finalizeSystem(
              theme
                ? { index: m.loadThemeIndex(theme, remInPx), mediaVariants: m.themeMediaVariants(theme, remInPx) }
                : { index: m.loadEmbeddedIndex(remInPx), mediaVariants: m.loadEmbeddedMediaVariants() },
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
  /** Memoized declaration conversions (`prop|value` -> classes + notes). */
  private declCache = new Map<string, DeclResult>()

  constructor(options: ConverterOptions = {}) {
    this.options = {
      remInPx: options.remInPx ?? 16,
      arbitrary: options.arbitrary ?? true,
      colorThreshold: options.colorThreshold ?? 0.02,
      canonicalize: options.canonicalize ?? true,
      // Default to Tailwind's spacing-scale ceiling: reverse multipliers within
      // the conventional range (incl. dynamic in-between steps like `p-13`), but
      // keep oversized one-offs (`width: 600px` -> `w-[600px]`) arbitrary.
      maxSpacingSteps: options.maxSpacingSteps ?? 96,
      important: options.important ?? false,
      positions: options.positions ?? false,
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
    this.variantCtx = { mediaVariants: sys.mediaVariants, remInPx: this.options.remInPx }
  }

  /** Converts a CSS string into Tailwind utilities, grouped per selector. */
  async convert(css: string): Promise<ConvertResult> {
    await this.init()
    const nodes: ConvertedNode[] = []
    const warnings: Warning[] = []
    let totalDecls = 0
    for (const rule of parseStylesheet(css)) {
      const media = this.atRuleVariants(rule.atRules)
      for (const selector of rule.selectors) {
        totalDecls += rule.decls.length
        const node = this.convertRule(rule.decls, selector, media, warnings)
        if (node) {
          if (this.options.positions) node.position = positionOf(css, rule.start, rule.end)
          nodes.push(node)
        }
      }
    }
    return { nodes, warnings, summary: summarize(nodes, warnings, totalDecls) }
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
      } else if (at.name === 'container') {
        const v = containerVariant(at.params, this.containerVariants(), this.options.remInPx)
        if (!v) return null
        variants.push(v)
      } else {
        return null
      }
    }
    return variants
  }

  private convertRule(
    decls: ParsedDecl[],
    selector: string,
    media: string[] | null,
    warnings: Warning[],
  ): ConvertedNode | null {
    const { base, variants: pseudoVariants } = selectorVariants(selector)
    const sel = base || selector
    const items: Cls[] = []
    const complementary: string[] = []
    let fontSizeCls: Cls | undefined
    let fontSizeValue: string | undefined
    let leadingCls: Cls | undefined
    let lineHeightValue: string | undefined

    for (const decl of decls) {
      const prop = decl.prop.toLowerCase()
      const important = this.options.important && decl.important
      // If the rule sits under an unsupported at-rule, nothing is convertible.
      const result = media === null ? { classes: [], notes: [] as string[] } : this.convertDeclaration(prop, decl.value)
      if (result.classes.length) {
        const produced = result.classes.map((name) => ({ name, important }))
        // Remember the font-size / line-height classes so we can fuse them (below).
        if (prop === 'font-size' && produced.length === 1 && produced[0].name.startsWith('text-')) {
          fontSizeCls = produced[0]
          fontSizeValue = decl.value.trim()
        } else if (prop === 'line-height' && produced.length === 1 && produced[0].name.startsWith('leading-')) {
          leadingCls = produced[0]
          lineHeightValue = decl.value.trim()
        }
        items.push(...produced)
        for (const message of result.notes) {
          warnings.push({ type: 'approximate-color', selector: sel, declaration: stringifyDecl(decl), message })
        }
      } else {
        complementary.push(stringifyDecl(decl))
        warnings.push({
          type: 'unconvertible',
          selector: sel,
          declaration: stringifyDecl(decl),
          message: `no Tailwind utility for "${decl.prop}: ${decl.value}"`,
        })
      }
    }

    if (items.length === 0 && complementary.length === 0) return null

    // A v4 `text-<size>` utility already carries a default line-height, so drop a
    // matching line-height entirely (`text-sm`); only keep the `/N` shorthand when
    // it diverges from the active theme's default (`text-sm/6`). Then recombine
    // equal opposite longhands (`pl-6 pr-6` -> `px-6`, corner radii -> `rounded-t`).
    let out = items
    if (fontSizeCls && leadingCls) {
      const name = fontSizeCls.name
      const token = name.startsWith('text-') && !name.includes('[') ? name.slice('text-'.length) : undefined
      const defaultLh = token ? this.index!.textLineHeights.get(token) : undefined
      const inputLh =
        lineHeightValue !== undefined ? absoluteLineHeight(lineHeightValue, fontSizeValue, this.options.remInPx) : null
      const matchesDefault = defaultLh !== undefined && inputLh !== null && inputLh === defaultLh
      out = matchesDefault
        ? out.filter((c) => c !== leadingCls) // text-<token> already sets this line-height
        : [
            ...out.filter((c) => c !== fontSizeCls && c !== leadingCls),
            { name: `${name}/${leadingCls.name.slice('leading-'.length)}`, important: fontSizeCls.important || leadingCls.important },
          ]
    }
    out = combineDirectional(out)

    const prefix = [...(media ?? []), ...pseudoVariants].map((v) => `${v}:`).join('')
    // v4 puts the important bang at the very end (`sm:text-red-500!`).
    const named = out.map((c) => (c.important ? `${c.name}!` : c.name))
    const prefixed = prefix ? named.map((c) => applyVariantPrefix(prefix, c)) : named
    const ordered = this.orderClasses(prefixed)

    return {
      selector: sel,
      tailwindClasses: ordered,
      complementary: complementary.join('; '),
    }
  }

  /** Converts a declaration to utility class(es) + notes, memoized per (prop, value). */
  private convertDeclaration(prop: string, value: string): DeclResult {
    const trimmed = value.trim()
    const cacheKey = `${prop}|${trimmed}`
    const cached = this.declCache.get(cacheKey)
    if (cached !== undefined) return cached
    const result = this.convertDeclarationUncached(prop, trimmed)
    this.declCache.set(cacheKey, result)
    return result
  }

  private convertDeclarationUncached(prop: string, trimmed: string): DeclResult {
    // `text-decoration` is a shorthand; its single-keyword form maps to the
    // `text-decoration-line` utility (`none` -> `no-underline`, `underline`).
    if (prop === 'text-decoration' && !/\s/.test(trimmed)) {
      const r = this.convertSingle('text-decoration-line', trimmed)
      if (r) return { classes: [r.cls], notes: r.note ? [r.note] : [] }
    }

    // Multi-value `padding`/`margin` shorthands split into axis utilities
    // (`padding: 0 24px` -> `py-0 px-6`). Falls through if any part can't convert.
    const box = expandBoxShorthand(prop, trimmed)
    if (box) {
      const classes: string[] = []
      const notes: string[] = []
      let ok = true
      for (const part of box) {
        const r = this.convertSingle(part.prop, part.value)
        if (!r) { ok = false; break }
        classes.push(r.cls)
        if (r.note) notes.push(r.note)
      }
      if (ok) return { classes, notes }
    }

    // Composite transform/filter/gradient declarations decompose into per-function
    // utilities. The reverse index would map these props to a wrong root, so own
    // them fully here (falling back to a faithful arbitrary property, never a guess).
    const decomposed = this.decomposeFunctional(prop, trimmed)
    if (decomposed) return decomposed

    const single = this.convertSingle(prop, trimmed)
    return single ? { classes: [single.cls], notes: single.note ? [single.note] : [] } : { classes: [], notes: [] }
  }

  /**
   * Owns properties whose reverse-index root would produce an invalid or wrong
   * utility: `transform`/`filter`/gradients decompose per-function, and the
   * overloaded `background-*`/`box-shadow` props map to their correct arbitrary
   * root (the index otherwise picks `bg-conic`/`inset-ring`/`bg-auto`). Returns
   * null for props it doesn't own.
   */
  private decomposeFunctional(prop: string, value: string): DeclResult | null {
    const isGradient = (prop === 'background-image' || prop === 'background') && /gradient\(/i.test(value)
    const owned =
      prop === 'transform' ||
      prop === 'filter' ||
      prop === 'background-image' ||
      prop === 'background-size' ||
      prop === 'background-position' ||
      prop === 'box-shadow' ||
      isGradient
    if (!owned) return null

    // Prefer an exact named utility (`transform-none`, `bg-none`, `bg-cover`, `shadow-lg`).
    const exact = this.index!.decls.get(declKey(prop, value, this.options.remInPx))
    if (exact) return { classes: [exact], notes: [] }

    const ctx = this.functionsContext()
    const classes =
      prop === 'transform'
        ? decomposeTransform(value, ctx)
        : prop === 'filter'
          ? decomposeFilter(value, ctx)
          : isGradient
            ? decomposeGradient(value, ctx)
            : this.arbitraryBackground(prop, value)
    if (classes) return { classes, notes: [] }

    const arb = this.arbitraryFor(prop, value)
    return arb ? { classes: [arb], notes: [] } : { classes: [], notes: [] }
  }

  /**
   * The correct arbitrary utility for the overloaded `background-*`/`box-shadow`
   * properties (`background-image: url(…)` -> `bg-[url(…)]`, `background-size:
   * 5px 4px` -> `bg-size-[5px_4px]`, `background-position: top center` ->
   * `bg-position-[top_center]`, `box-shadow: …` -> `shadow-[…]`). Correct by
   * construction, so trusted like the other decomposers.
   */
  private arbitraryBackground(prop: string, value: string): string[] | null {
    if (!this.options.arbitrary) return null
    switch (prop) {
      case 'background-image':
        return [arbitraryUtility('bg', value)]
      case 'background-size':
        return [arbitraryUtility('bg-size', value)]
      case 'background-position':
        return [arbitraryUtility('bg-position', value)]
      case 'box-shadow':
        return [arbitraryUtility('shadow', value)]
      default:
        return null
    }
  }

  private functionsContext(): FunctionsContext {
    const index = this.index!
    return {
      spacing: (root, length) =>
        matchSpacing(root, length, index.spacingBaseRem, this.options.remInPx, this.options.maxSpacingSteps),
      blurToken: (length) => this.blurToken(length),
      colorStop: (root, color) => this.colorMatcher!.match(root, color, this.options.colorThreshold)?.className ?? null,
      hasRoot: (root) => index.rootRanks.has(root),
    }
  }

  private containerVariantsCache?: Map<string, string>
  /** Canonical container width condition (`(w>=384px)`) -> token name (`sm`), from `--container-*`. */
  private containerVariants(): Map<string, string> {
    if (!this.containerVariantsCache) {
      this.containerVariantsCache = new Map()
      for (const [key, value] of this.index!.vars) {
        const m = /^--container-(.+)$/.exec(key)
        const canonical = m ? canonicalizeMedia(`(min-width: ${value})`, this.options.remInPx) : null
        if (m && canonical) this.containerVariantsCache.set(canonical, m[1])
      }
    }
    return this.containerVariantsCache
  }

  private blurScale?: Map<string, string>
  /** Maps a blur length to its theme token (`4px` -> `xs`), built once from `--blur-*`. */
  private blurToken(length: string): string | null {
    if (!this.blurScale) {
      this.blurScale = new Map()
      for (const [key, value] of this.index!.vars) {
        const m = /^--blur-(.+)$/.exec(key)
        const px = m ? lengthToPx(value, this.options.remInPx) : null
        if (m && px !== null) this.blurScale.set(px, m[1])
      }
    }
    const px = lengthToPx(length, this.options.remInPx)
    return px !== null ? (this.blurScale.get(px) ?? null) : null
  }

  private convertSingle(prop: string, trimmed: string): SingleResult | null {
    const index = this.index!
    const wrap = (cls: string | null): SingleResult | null => (cls ? { cls } : null)

    if (isColorValue(trimmed)) {
      const root = index.colorRoots.get(prop)
      if (!root) return wrap(this.arbitraryFor(prop, trimmed))
      const match = this.colorMatcher!.match(root, trimmed, this.options.colorThreshold)
      if (match && this.verify(match.className, prop, trimmed)) {
        // Flag inexact matches so callers can warn. The threshold is above color-
        // space rounding noise (a canonical hex like #fb2c36 -> red-500 is ~0.001).
        const note =
          match.distance > 0.004
            ? `approximated ${trimmed} to ${match.className} (ΔE ${match.distance.toFixed(3)})`
            : undefined
        return { cls: match.className, note }
      }
      return wrap(this.arbitraryUtilityFor(root, prop, trimmed))
    }

    // Font-size maps to the `--text-*` scale (`20px` -> `text-xl`). Like v3, we
    // accept the named size even though it also carries a default line-height.
    if (prop === 'font-size') {
      const rem = normalizeLength(trimmed, this.options.remInPx)
      const token = rem ? index.textSizes.get(rem) : undefined
      if (token && this.verifyProducesFontSize(`text-${token}`, trimmed)) return { cls: `text-${token}` }
    }

    // Exact reverse-index match. These entries were built by rendering the class
    // through Tailwind, so they're ground-truth — no need to re-verify.
    const exact = index.decls.get(declKey(prop, trimmed, this.options.remInPx))
    if (exact) return { cls: exact }

    const root = index.propToRoot.get(prop)
    if (root && index.spacingRoots.has(root)) {
      const spaced = matchSpacing(
        root, trimmed, index.spacingBaseRem, this.options.remInPx, this.options.maxSpacingSteps,
      )
      if (spaced && this.verify(spaced, prop, trimmed)) return { cls: spaced }
    }
    if (root) return wrap(this.arbitraryUtilityFor(root, prop, trimmed))
    return wrap(this.arbitraryFor(prop, trimmed))
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
    if (base.endsWith('!')) base = base.slice(0, -1) // v4 important suffix
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

/** Computes a rule's 1-based line/column from its char offsets in the source. */
function positionOf(css: string, start: number, end: number): SourcePosition {
  let line = 1
  let column = 1
  for (let i = 0; i < start; i++) {
    if (css[i] === '\n') {
      line++
      column = 1
    } else {
      column++
    }
  }
  return { start, end, line, column }
}

/** Tallies conversion coverage. Each unconvertible declaration emits exactly one warning. */
function summarize(nodes: ConvertedNode[], warnings: Warning[], totalDecls: number): ConversionSummary {
  const unconvertible = warnings.reduce((n, w) => n + (w.type === 'unconvertible' ? 1 : 0), 0)
  const converted = totalDecls - unconvertible
  const arbitrary = nodes.reduce(
    (n, node) => n + node.tailwindClasses.filter((c) => c.includes('[') || c.includes('(--')).length,
    0,
  )
  const denom = converted + unconvertible
  return { converted, unconvertible, arbitrary, coverage: denom === 0 ? 1 : Math.round((converted / denom) * 1e4) / 1e4 }
}

/** Normalizes a length token to a canonical pixel string (`0.25rem` -> `4px`), or null. */
function lengthToPx(value: string, remInPx: number): string | null {
  const m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(value.trim())
  if (!m) return null
  const n = parseFloat(m[1]) * ((m[2] ?? 'px') === 'px' ? 1 : remInPx)
  return `${n}px`
}

// Merge two equal-valued opposite-side utilities into one: `pl-6 pr-6` -> `px-6`,
// `rounded-tl-sm rounded-tr-sm` -> `rounded-t-sm`, cascading (`px`+`py` -> `p`).
const COMBINE_RULES: [string, string, string][] = [
  ['pt', 'pb', 'py'], ['pl', 'pr', 'px'], ['px', 'py', 'p'],
  ['mt', 'mb', 'my'], ['ml', 'mr', 'mx'], ['mx', 'my', 'm'],
  ['top', 'bottom', 'inset-y'], ['left', 'right', 'inset-x'], ['inset-x', 'inset-y', 'inset'],
  ['w', 'h', 'size'],
  ['gap-x', 'gap-y', 'gap'],
  ['overscroll-x', 'overscroll-y', 'overscroll'],
  ['rounded-tl', 'rounded-tr', 'rounded-t'], ['rounded-bl', 'rounded-br', 'rounded-b'],
  ['rounded-tl', 'rounded-bl', 'rounded-l'], ['rounded-tr', 'rounded-br', 'rounded-r'],
  ['rounded-t', 'rounded-b', 'rounded'], ['rounded-l', 'rounded-r', 'rounded'],
]

/** The value a class carries for a given root: `pl-6`/`pl` -> `'6'`/`''`; null if not that root. */
function valueForRoot(cls: string, root: string): string | null {
  if (cls === root) return '' // bare default (e.g. `rounded-tl`)
  if (cls.startsWith(root + '-')) return cls.slice(root.length + 1)
  return null
}

function combineDirectional(classes: Cls[]): Cls[] {
  const out = [...classes]
  let merged = true
  while (merged) {
    merged = false
    for (const [a, b, into] of COMBINE_RULES) {
      const ai = out.findIndex((c) => valueForRoot(c.name, a) !== null)
      if (ai === -1) continue
      const value = valueForRoot(out[ai].name, a)!
      // `w-screen`+`h-screen` must not merge: `w-screen` is 100vw but `h-screen`
      // is 100vh, so `size-screen` isn't equivalent (and isn't a real utility).
      if (into === 'size' && value === 'screen') continue
      const important = out[ai].important
      // Only merge opposite sides that share the same importance (`pl-6! pr-6!` -> `px-6!`,
      // but a mixed `pl-6! pr-6` stays split — one class can't carry both).
      const bi = out.findIndex((c) => c.important === important && valueForRoot(c.name, b) === value)
      if (bi === -1) continue
      const combined = value === '' ? into : `${into}-${value}`
      out.splice(Math.max(ai, bi), 1)
      out.splice(Math.min(ai, bi), 1)
      out.push({ name: combined, important })
      merged = true
      break
    }
  }
  return out
}

function applyVariantPrefix(prefix: string, className: string): string {
  // Negative utilities keep the leading `-` outermost: `md:-mt-4`.
  if (className.startsWith('-')) return `${prefix}-${className.slice(1)}`
  return `${prefix}${className}`
}
