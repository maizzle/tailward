import safeParse from 'postcss-safe-parser'
import type { Rule, Declaration, AtRule } from 'postcss'
import { parse as colorParse, converter as culoriConverter, differenceEuclidean } from 'culori'
import { loadDesignSystem, type DesignSystem } from './design-system.ts'
import {
  buildReverseIndex,
  declKey,
  isColorValue,
  resolveClassDecls,
  type ReverseIndex,
} from './reverse-index.ts'
import { normalizeLength } from './normalize.ts'
import { createColorMatcher, type ColorMatcher } from './matchers/color.ts'
import { matchSpacing } from './matchers/spacing.ts'
import { arbitraryUtility, arbitraryProperty } from './matchers/arbitrary.ts'
import { expandBoxShorthand } from './matchers/shorthand.ts'
import { selectorVariants, mediaVariant, type VariantContext } from './variants.ts'
import type { ConverterOptions, ConvertResult, ConvertedNode } from './types.ts'

const toOklab = culoriConverter('oklab')
const colorDistance = differenceEuclidean('oklab')

/** The parts of a loaded system that depend only on css/base/remInPx. */
interface LoadedSystem {
  ds: DesignSystem
  index: ReverseIndex
  colorMatcher: ColorMatcher
  breakpoints: Map<string, string>
}

// Building the reverse index costs ~1s, so cache it across converter instances
// that share the same theme + rem scale (color/arbitrary options don't affect it).
const systemCache = new Map<string, Promise<LoadedSystem>>()

function loadSystem(css: string | undefined, base: string | undefined, remInPx: number): Promise<LoadedSystem> {
  const key = `${base ?? ''}|${remInPx}|${css ?? ''}`
  let cached = systemCache.get(key)
  if (!cached) {
    cached = (async () => {
      const ds = await loadDesignSystem(css, base)
      const index = buildReverseIndex(ds, remInPx)
      const breakpoints = new Map<string, string>()
      for (const [name, value] of index.vars) {
        if (name.startsWith('--breakpoint-')) {
          const rem = normalizeLength(value, remInPx)
          if (rem) breakpoints.set(rem, name.slice('--breakpoint-'.length))
        }
      }
      return { ds, index, colorMatcher: createColorMatcher(index.palette), breakpoints }
    })()
    systemCache.set(key, cached)
  }
  return cached
}

export class CssToTailwind {
  private options: Required<Omit<ConverterOptions, 'css' | 'base'>> & Pick<ConverterOptions, 'css' | 'base'>
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
      css: options.css,
      base: options.base,
    }
  }

  /** Loads the design system and builds the reverse index (idempotent, cached). */
  private async init(): Promise<void> {
    if (this.ds) return
    const sys = await loadSystem(this.options.css, this.options.base, this.options.remInPx)
    this.ds = sys.ds
    this.index = sys.index
    this.colorMatcher = sys.colorMatcher
    this.variantCtx = { breakpoints: sys.breakpoints, remInPx: this.options.remInPx }
  }

  /** Converts a CSS string into Tailwind utilities, grouped per selector. */
  async convert(css: string): Promise<ConvertResult> {
    await this.init()
    const root = safeParse(css)
    const nodes: ConvertedNode[] = []

    root.walkRules((rule) => {
      // Skip nested container selectors handled via their ancestor at-rules.
      const media = this.collectMediaVariants(rule)
      for (const selector of rule.selectors) {
        const node = this.convertRule(rule, selector, media)
        if (node) nodes.push(node)
      }
    })

    return { nodes }
  }

  /** Walks a rule's ancestor at-rules into variant prefixes, or null if unsupported. */
  private collectMediaVariants(rule: Rule): string[] | null {
    const variants: string[] = []
    let parent: import('postcss').Container | import('postcss').Document | undefined = rule.parent
    while (parent && parent.type === 'atrule') {
      const at = parent as AtRule
      if (at.name === 'media') {
        const v = mediaVariant(at.params, this.variantCtx!)
        if (!v) return null
        variants.unshift(v)
      } else if (at.name === 'supports') {
        // `(display: grid)` -> `supports-[display:grid]`; strip one wrapping paren pair.
        let feat = at.params.replace(/\s+/g, '')
        if (feat.startsWith('(') && feat.endsWith(')')) feat = feat.slice(1, -1)
        variants.unshift(`supports-[${feat}]`)
      } else {
        return null
      }
      parent = at.parent
    }
    return variants
  }

  private convertRule(rule: Rule, selector: string, media: string[] | null): ConvertedNode | null {
    const { base, variants: pseudoVariants } = selectorVariants(selector)
    const classes: string[] = []
    const complementary: string[] = []

    for (const child of rule.nodes) {
      if (child.type !== 'decl') continue
      const decl = child as Declaration
      // If the rule sits under an unsupported at-rule, nothing is convertible.
      if (media === null) {
        complementary.push(stringifyDecl(decl))
        continue
      }
      const cls = this.convertDeclaration(decl.prop.toLowerCase(), decl.value)
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
    // `z-60`, `order: 13` -> `order-13`). We guess `root-<number>` and verify it
    // against the engine — far cheaper than Tailwind's canonicalizeCandidates,
    // which carries a large first-call warmup cost.
    if (this.options.canonicalize && /^\d+$/.test(value)) {
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

  /** Confirms a class produces exactly the input declaration and nothing else. */
  private verify(className: string, prop: string, value: string): boolean {
    const decls = resolveClassDecls(this.ds!, className, this.index!.vars)
    if (!decls || decls.length !== 1) return false
    const only = decls[0]
    return only.prop === prop && this.valueEquals(prop, only.value, value)
  }

  /**
   * Confirms a class sets the given font-size (ignoring any companion line-height
   * the size utility also carries — mirrors css-to-tailwindcss's behavior).
   */
  private verifyProducesFontSize(className: string, value: string): boolean {
    const decls = resolveClassDecls(this.ds!, className, this.index!.vars)
    const fs = decls?.find((d) => d.prop === 'font-size')
    return fs ? this.valueEquals('font-size', fs.value, value) : false
  }

  /** Compares two declaration values (colors by ΔE, lengths/keywords canonically). */
  private valueEquals(prop: string, a: string, b: string): boolean {
    if (isColorValue(b)) {
      const ca = colorParse(a)
      const cb = colorParse(b)
      if (!ca || !cb) return a.trim().toLowerCase() === b.trim().toLowerCase()
      return colorDistance(toOklab(ca), toOklab(cb)) <= Math.max(this.options.colorThreshold, 1e-4)
    }
    return declKey(prop, a, this.options.remInPx) === declKey(prop, b, this.options.remInPx)
  }

  /** Sorts classes into Tailwind's canonical class order. */
  private orderClasses(classes: string[]): string[] {
    try {
      const order = this.ds!.getClassOrder(classes)
      return [...order]
        .sort((a, b) => {
          if (a[1] === b[1]) return 0
          if (a[1] === null) return -1
          if (b[1] === null) return 1
          return a[1] < b[1] ? -1 : 1
        })
        .map((e) => e[0])
    } catch {
      return classes
    }
  }
}

function stringifyDecl(decl: Declaration): string {
  return `${decl.prop}: ${decl.value}${decl.important ? ' !important' : ''}`
}

function applyVariantPrefix(prefix: string, className: string): string {
  // Negative utilities keep the leading `-` outermost: `md:-mt-4`.
  if (className.startsWith('-')) return `${prefix}-${className.slice(1)}`
  return `${prefix}${className}`
}
