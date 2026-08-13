import type { DesignSystem } from './design-system.ts'
import { isColor } from './color.ts'
import { resolveVars, evalCalc, normalizeLength, normalizeValue, absoluteLineHeight } from './normalize.ts'
import { canonicalizeMedia } from './variants.ts'

/**
 * Builds a map of canonical media condition -> variant name by rendering each
 * media-based variant (`sm:`, `dark:`, custom `@custom-variant`s...) and reading
 * the `@media (…)` it produces. Lets input `@media` queries resolve to exact
 * named variants (`max-width: 430px` -> `xs`).
 */
export function computeMediaVariants(ds: DesignSystem, remInPx: number): Map<string, string> {
  const map = new Map<string, string>()
  for (const variant of ds.getVariants()) {
    let css: string | null
    try {
      css = ds.candidatesToCss([`${variant.name}:block`])[0]
    } catch {
      continue
    }
    if (!css) continue
    // Accept only utilities whose CSS is an `@media (…) { … }` wrapper.
    const flat = css.replace(/\s+/g, ' ').trim()
    const m = /^@media([^{]+)\{/.exec(flat)
    if (!m) continue
    const key = canonicalizeMedia(m[1], remInPx)
    if (key && !map.has(key)) map.set(key, variant.name)
  }
  return map
}

export interface ReverseIndex {
  /** `prop|normalizedValue` -> shortest Tailwind class producing exactly that declaration. */
  decls: Map<string, string>
  /** CSS property -> utility root, for arbitrary length/generic fallbacks (e.g. `padding` -> `p`). */
  propToRoot: Map<string, string>
  /** CSS property -> utility root for color-valued utilities (e.g. `color` -> `text`). */
  colorRoots: Map<string, string>
  /** Palette token (`red-500`) -> concrete color value from the theme. */
  palette: Map<string, string>
  /** Normalized font-size (`1.25rem`) -> `--text-*` token (`xl`). */
  textSizes: Map<string, string>
  /** `--text-*` token (`sm`) -> its default line-height, so `text-sm` can absorb a matching one. */
  textLineHeights: Map<string, string>
  /** Roots that derive from the `--spacing` multiplier (e.g. `p`, `m`, `gap`). */
  spacingRoots: Set<string>
  /** The `--spacing` base in rem (default `0.25`). */
  spacingBaseRem: number
  /** Roots that accept a bare integer value (`z` -> `z-60`, `order` -> `order-13`). */
  numericRoots: Set<string>
  /**
   * Utility root (or static class name) -> ordinal position in Tailwind's class
   * order. Lets us sort output without the engine (`getClassOrder`).
   */
  rootRanks: Map<string, number>
  /** Resolved theme variables (`--color-red-500` -> `oklch(...)`). Empty when embedded. */
  vars: Map<string, string>
}

/** Resolves the real declarations a class produces, concretized for comparison. */
export function resolveClassDecls(
  ds: DesignSystem,
  className: string,
  vars: Map<string, string>,
): Decl[] | null {
  const css = ds.candidatesToCss([className])[0]
  if (!css) return null
  let raw: Decl[] | null
  try {
    raw = realDecls(css)
  } catch {
    return null
  }
  if (!raw) return null
  return raw.map((d) => ({ prop: d.prop, value: concretize(d.value, vars) }))
}

const isCustomProp = (prop: string) => prop.startsWith('--')

/** Is this resolved value a color (and not a bare length/keyword we handle elsewhere)? */
export function isColorValue(value: string): boolean {
  return isColor(value)
}

interface Decl {
  prop: string
  value: string
}

/** Resolves a generated utility value to a concrete, comparable form. */
function concretize(value: string, vars: Map<string, string>): string {
  return evalCalc(resolveVars(value, vars)).replace(/\s+/g, ' ').trim()
}

/** Maps each `--text-*` token to its default line-height, resolved to absolute rem. */
export function collectTextLineHeights(vars: Map<string, string>, remInPx: number): Map<string, string> {
  const map = new Map<string, string>()
  for (const [name, value] of vars) {
    const m = /^--text-(.+)--line-height$/.exec(name)
    if (!m) continue
    const fontSize = vars.get(`--text-${m[1]}`)
    const abs = absoluteLineHeight(
      concretize(value, vars),
      fontSize ? concretize(fontSize, vars) : undefined,
      remInPx,
    )
    if (abs) map.set(m[1], abs)
  }
  return map
}

// A single class selector once escaped chars are removed: `.p-4`, `.p-[13px]`
// (as `.p-\[13px\]`) pass; pseudos (`:hover`), combinators and nesting (`&`) fail.
function isSimpleClassSelector(selector: string): boolean {
  const bare = selector.replace(/\\./g, '') // drop escaped char pairs (\[ \] \# \: ...)
  return /^\.[^\s,>+~:&[\]()]*$/.test(bare)
}

// Trailing content after the main rule may only be `@property` blocks (which
// declare the `--tw-*` custom properties). Anything else — `@media`, `@supports`,
// a second style rule — means the utility is conditional and we don't index it.
const ONLY_PROPERTY_BLOCKS = /^(@property\b[^{]*\{[^{}]*\}\s*)+$/

/**
 * Extracts the real (non-`--tw-*`) declarations from a candidate whose CSS is a
 * single simple-class rule. Returns null for utilities that need pseudos,
 * combinators or nesting (e.g. `placeholder-*`, `divide-*`), which we don't index.
 *
 * Hand-rolled rather than PostCSS: generated utility CSS is trivially regular,
 * and this runs ~23k times at index-build, where PostCSS dominates the cost.
 */
function realDecls(css: string): Decl[] | null {
  const open = css.indexOf('{')
  if (open === -1) return null
  if (!isSimpleClassSelector(css.slice(0, open).trim())) return null

  const bodyEnd = matchBrace(css, open)
  if (bodyEnd === -1) return null
  const body = css.slice(open + 1, bodyEnd)
  if (body.includes('{')) return null // nested rule (e.g. pseudo, group) — skip

  const rest = css.slice(bodyEnd + 1).trim()
  if (rest && !ONLY_PROPERTY_BLOCKS.test(rest)) return null

  const decls: Decl[] = []
  for (const part of splitTopLevel(body, ';')) {
    const colon = part.indexOf(':')
    if (colon === -1) continue
    const prop = part.slice(0, colon).trim().toLowerCase()
    if (!prop || isCustomProp(prop)) continue
    // Strip `!important` (the `@import "tailwindcss/utilities" important` layer, as
    // used by email presets, marks every utility important — the input CSS won't).
    const value = part.slice(colon + 1).replace(/\s*!\s*important\s*$/i, '').trim()
    decls.push({ prop, value })
  }
  return decls
}

/** Index of the `}` matching the `{` at `open`, or -1 if unbalanced. */
function matchBrace(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}' && --depth === 0) return i
  }
  return -1
}

/** Splits on `sep`, ignoring separators nested inside (), [], "" or ''. */
function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quote) {
      if (ch === quote && s[i - 1] !== '\\') quote = ''
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '(' || ch === '[') {
      depth++
    } else if (ch === ')' || ch === ']') {
      depth--
    } else if (ch === sep && depth === 0) {
      parts.push(s.slice(start, i))
      start = i + 1
    }
  }
  parts.push(s.slice(start))
  return parts
}

/** Canonical key for a resolved declaration used in the reverse index. */
export function declKey(prop: string, value: string, remInPx: number): string {
  const length = normalizeLength(value, remInPx)
  return `${prop}|${length ?? normalizeValue(value)}`
}

/** Builds the reverse index from the design system's full class list. */
export function buildReverseIndex(ds: DesignSystem, remInPx: number): ReverseIndex {
  const vars = new Map<string, string>()
  const palette = new Map<string, string>()
  const textSizes = new Map<string, string>()
  for (const [name, entry] of ds.theme.values) {
    const val = entry.value.replace(/\s+/g, ' ').trim()
    vars.set(name, val)
    if (name.startsWith('--color-')) palette.set(name.slice('--color-'.length), val)
    // `--text-xl` is a size; `--text-xl--line-height` is its companion — skip the latter.
    if (name.startsWith('--text-') && !name.includes('--line-height')) {
      const token = name.slice('--text-'.length)
      const rem = normalizeLength(val, remInPx)
      if (rem) textSizes.set(rem, token)
    }
  }

  const decls = new Map<string, string>()
  const propToRoot = new Map<string, string>()
  const colorRoots = new Map<string, string>()
  const spacingRoots = new Set<string>()
  const radiusRoots = new Set<string>()
  // Tracks whether a property's root came from a single- or multi-declaration
  // utility, so single-declaration utilities always win (in first-seen order).
  const rootSource = new Map<string, 'single' | 'multi'>()

  const spacingBaseRem = (() => {
    const n = normalizeLength(vars.get('--spacing') ?? '0.25rem', remInPx)
    return n ? parseFloat(n) : 0.25
  })()

  // Palette-colored utilities (`bg-red-500`, `text-sky-300/50`) are handled
  // algorithmically by the color matcher and never stored in the index, so
  // rendering all ~15k of them is pure waste. Skip them, keeping just one
  // representative per root so color-root derivation (`background-color` -> `bg`)
  // still works. This roughly halves the cost of building the index.
  const colorTokens = new Set(palette.keys())
  const names: string[] = []
  const colorSampleRoots = new Set<string>()
  for (const name of ds.getClassList().map((e) => e[0])) {
    const parsed = ds.parseCandidate(name)[0]
    const value = parsed?.value?.kind === 'named' ? parsed.value.value : null
    if (value && colorTokens.has(value)) {
      const root = parsed!.root
      if (colorSampleRoots.has(root)) continue
      colorSampleRoots.add(root) // keep the first utility of each color root
    }
    names.push(name)
  }
  const cssList = ds.candidatesToCss(names)

  for (let i = 0; i < names.length; i++) {
    const css = cssList[i]
    if (!css) continue
    const name = names[i]

    let raw: Decl[] | null
    try {
      raw = realDecls(css)
    } catch {
      continue
    }
    if (!raw || raw.length === 0) continue

    const resolved = raw.map((d) => ({ prop: d.prop, value: concretize(d.value, vars) }))
    const root = utilityRoot(ds, name)

    if (root && !root.startsWith('-')) {
      if (resolved.length === 1) {
        // Single-declaration utilities are authoritative; first seen wins, and
        // they override any root a multi-declaration utility guessed earlier.
        const { prop, value } = resolved[0]
        if (isColorValue(value)) {
          if (!colorRoots.has(prop)) colorRoots.set(prop, root)
        } else if (rootSource.get(prop) !== 'single') {
          propToRoot.set(prop, root)
          rootSource.set(prop, 'single')
        }
      } else {
        // Multi-declaration utilities (e.g. `text-xl` sets font-size + line-height)
        // fill in roots for otherwise-unclaimed properties like `font-size` -> `text`.
        // A wrong guess just fails verification at convert time and falls back.
        for (const { prop, value } of resolved) {
          if (!isColorValue(value) && !propToRoot.has(prop)) {
            propToRoot.set(prop, root)
            rootSource.set(prop, 'multi')
          }
        }
      }
    }

    // Derive the exact index + spacing roots from single-declaration utilities.
    if (resolved.length === 1) {
      const { prop, value } = resolved[0]
      // Colors are matched by the color matcher, not the exact string index.
      if (!isColorValue(value)) {
        const key = declKey(prop, value, remInPx)
        const existing = decls.get(key)
        if (!existing || name.length < existing.length) decls.set(key, name)
        if (root && prop.includes('radius')) radiusRoots.add(root)
        // A root is spacing-based if its numeric token equals value / --spacing.
        if (root && !root.startsWith('-')) {
          const parsed = ds.parseCandidate(name)[0]
          const token = parsed?.value?.kind === 'named' ? parsed.value.value : null
          const rem = normalizeLength(value, remInPx)
          if (token && /^\d+$/.test(token) && rem !== null) {
            if (Math.abs(parseFloat(rem) - Number(token) * spacingBaseRem) < 1e-9) {
              spacingRoots.add(root)
            }
          }
        }
      }
    }
  }

  // `getClassList` omits the bare-default radius utilities (`rounded`, `rounded-t`,
  // `rounded-tl` = `border-radius: var(--radius)`), so a value equal to the default
  // radius would otherwise only match the longer `-sm` token. Index the bare forms;
  // the shortest-name tie-break then prefers `rounded` over `rounded-sm`.
  const bareRoots = [...radiusRoots]
  const bareCss = ds.candidatesToCss(bareRoots)
  bareRoots.forEach((name, i) => {
    const css = bareCss[i]
    if (!css) return
    let raw: Decl[] | null
    try {
      raw = realDecls(css)
    } catch {
      return
    }
    if (!raw || raw.length !== 1) return
    const prop = raw[0].prop
    const value = concretize(raw[0].value, vars)
    if (isColorValue(value)) return
    const key = declKey(prop, value, remInPx)
    const existing = decls.get(key)
    if (!existing || name.length < existing.length) decls.set(key, name)
  })

  const numericRoots = computeNumericRoots(ds, names)
  const rootRanks = computeRootRanks(ds, names)

  return {
    decls, propToRoot, colorRoots, palette, textSizes,
    textLineHeights: collectTextLineHeights(vars, remInPx),
    spacingRoots, spacingBaseRem, numericRoots, rootRanks, vars,
  }
}

/** Finds roots that accept a bare integer value (probing `root-97`). */
function computeNumericRoots(ds: DesignSystem, names: string[]): Set<string> {
  const roots = new Set<string>()
  for (const name of names) {
    const r = utilityRoot(ds, name)
    if (r && !r.startsWith('-')) roots.add(r)
  }
  const list = [...roots]
  const css = ds.candidatesToCss(list.map((r) => `${r}-97`))
  const numeric = new Set<string>()
  list.forEach((r, i) => {
    const c = css[i]
    if (c && realDecls(c)?.length) numeric.add(r)
  })
  return numeric
}

/** Maps each root / static class to its ordinal in Tailwind's class order. */
function computeRootRanks(ds: DesignSystem, names: string[]): Map<string, number> {
  const ranks = new Map<string, number>()
  try {
    const order = ds
      .getClassOrder(names)
      .filter((e): e is [string, bigint] => e[1] !== null)
      .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    order.forEach(([name], i) => {
      const key = utilityRoot(ds, name) ?? name
      if (!ranks.has(key)) ranks.set(key, i)
    })
  } catch {
    // ordering is best-effort
  }
  return ranks
}

const rootCache = new WeakMap<DesignSystem, Map<string, string | null>>()

/** Returns the functional/static root of a utility name (e.g. `p-4` -> `p`). */
function utilityRoot(ds: DesignSystem, name: string): string | null {
  let cache = rootCache.get(ds)
  if (!cache) rootCache.set(ds, (cache = new Map()))
  if (cache.has(name)) return cache.get(name)!
  let root: string | null = null
  try {
    const parsed = ds.parseCandidate(name)
    root = parsed[0]?.root ?? null
  } catch {
    root = null
  }
  cache.set(name, root)
  return root
}
