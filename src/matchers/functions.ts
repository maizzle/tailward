/**
 * Decomposes composite `transform`, `filter`, and gradient `background(-image)`
 * declarations into the per-function Tailwind v4 utilities
 * (`transform: translateX(10px) rotate(45deg)` -> `translate-x-2.5 rotate-45`,
 * `filter: blur(4px)` -> `blur-xs`, `linear-gradient(to right, a, b)` ->
 * `bg-linear-to-r from-a to-b`). The v4 utilities set the individual `translate`/
 * `scale`/`rotate` properties and gradient custom properties rather than the
 * `transform`/`background-image` longhand, so these are trusted deterministic
 * matchers (not engine-verifiable) gated on the theme actually providing the token.
 */
import valueParser from 'postcss-value-parser'

/** A parsed CSS function call: `translateX(10px)` -> `{ name: 'translatex', args: ['10px'] }`. */
export interface CssFunction {
  name: string
  args: string[]
}

/** Operations the decomposers need from the active theme/index. */
export interface FunctionsContext {
  /** Spacing utility for a length, sign-aware (`translate-x`, `10px` -> `translate-x-2.5`). */
  spacing(root: string, length: string): string | null
  /** Blur token name for a length (`4px` -> `xs`), or null if off-scale. */
  blurToken(length: string): string | null
  /** Gradient stop utility for a color (`from`, `#fb2c36` -> `from-red-500`). */
  colorStop(root: string, color: string): string | null
  /** Whether a utility root exists in the active theme. */
  hasRoot(root: string): boolean
}

/**
 * Parses a value that is purely a whitespace-separated list of function calls.
 * Returns null for anything else (a bare keyword like `none`, `var(...)`, etc.).
 */
export function parseFunctionList(value: string): CssFunction[] | null {
  const fns: CssFunction[] = []
  for (const node of valueParser(value).nodes) {
    if (node.type === 'space' || node.type === 'div') continue
    if (node.type !== 'function' || !node.value) return null
    fns.push({ name: node.value.toLowerCase(), args: splitArgs(node.nodes) })
  }
  return fns.length ? fns : null
}

/** Splits a function's argument nodes on top-level commas into trimmed strings. */
function splitArgs(nodes: valueParser.Node[]): string[] {
  const args: string[] = []
  let cur = ''
  for (const n of nodes) {
    if (n.type === 'div' && n.value === ',') {
      args.push(cur.trim())
      cur = ''
    } else {
      cur += valueParser.stringify(n)
    }
  }
  if (cur.trim() !== '') args.push(cur.trim())
  return args
}

/** A filter/scale amount as a percentage: `1.5` -> 150, `150%` -> 150, `0.5` -> 50. */
export function amountToPercent(arg: string): number | null {
  const m = /^(-?\d*\.?\d+)(%?)$/.exec(arg.trim())
  if (!m) return null
  const n = parseFloat(m[1])
  const pct = m[2] ? n : n * 100
  return Number.isInteger(pct) ? pct : null
}

/** A degree angle: `45deg` -> 45, `-45deg` -> -45. Null if not whole degrees. */
export function degrees(arg: string): number | null {
  const m = /^(-?\d*\.?\d+)deg$/.exec(arg.trim())
  if (!m) return null
  const n = parseFloat(m[1])
  return Number.isInteger(n) ? n : null
}

/** Signs a numeric utility: `(root, 150)` -> `root-150`, negatives -> `-root-150`. */
function signed(root: string, n: number): string {
  return n < 0 ? `-${root}-${Math.abs(n)}` : `${root}-${n}`
}

function scaleClass(root: string, arg: string): string | null {
  const pct = amountToPercent(arg)
  return pct === null ? null : signed(root, pct)
}

function skewClass(root: string, arg: string): string | null {
  const deg = degrees(arg)
  return deg === null ? null : signed(root, deg)
}

/** Maps a single transform function to its utilities, or null if unmappable. */
function transformFn(fn: CssFunction, ctx: FunctionsContext): string[] | null {
  const [a, b] = fn.args
  const one = (cls: string | null) => (cls ? [cls] : null)
  const pair = (x: string | null, y: string | null) => (x && y ? [x, y] : null)

  switch (fn.name) {
    case 'translatex':
      return one(ctx.spacing('translate-x', a))
    case 'translatey':
      return one(ctx.spacing('translate-y', a))
    case 'translatez':
      return one(ctx.spacing('translate-z', a))
    case 'translate':
      return b === undefined ? one(ctx.spacing('translate-x', a)) : pair(ctx.spacing('translate-x', a), ctx.spacing('translate-y', b))
    case 'scalex':
      return one(scaleClass('scale-x', a))
    case 'scaley':
      return one(scaleClass('scale-y', a))
    case 'scale':
      if (b === undefined || a === b) return one(scaleClass('scale', a))
      return pair(scaleClass('scale-x', a), scaleClass('scale-y', b))
    case 'rotate':
      return one(skewClass('rotate', a)) // rotate takes whole degrees, same shape as skew
    case 'skewx':
      return one(skewClass('skew-x', a))
    case 'skewy':
      return one(skewClass('skew-y', a))
    case 'skew':
      if (b === undefined || a === b) return one(skewClass('skew', a))
      return pair(skewClass('skew-x', a), skewClass('skew-y', b))
    default:
      return null
  }
}

/** `transform` -> per-function utilities, or null if any function is unmappable. */
export function decomposeTransform(value: string, ctx: FunctionsContext): string[] | null {
  const fns = parseFunctionList(value)
  if (!fns) return null
  const classes: string[] = []
  for (const fn of fns) {
    const mapped = transformFn(fn, ctx)
    if (!mapped) return null
    classes.push(...mapped)
  }
  return classes.length ? classes : null
}

/** Maps a single filter function to its utility, or null if unmappable. */
function filterFn(fn: CssFunction, ctx: FunctionsContext): string | null {
  const arg = fn.args[0]
  const pct = () => {
    const p = amountToPercent(arg)
    return p === null || p < 0 ? null : p
  }
  // grayscale/invert/sepia have a bare form meaning 100%.
  const bareAt100 = (root: string): string | null => {
    const p = pct()
    return p === null ? null : p === 100 ? root : `${root}-${p}`
  }

  switch (fn.name) {
    case 'blur': {
      const token = ctx.blurToken(arg)
      return token ? `blur-${token}` : null
    }
    case 'brightness':
    case 'contrast':
    case 'saturate': {
      const p = pct()
      return p === null ? null : `${fn.name}-${p}`
    }
    case 'grayscale':
      return bareAt100('grayscale')
    case 'invert':
      return bareAt100('invert')
    case 'sepia':
      return bareAt100('sepia')
    case 'hue-rotate':
      return skewClass('hue-rotate', arg)
    default:
      return null
  }
}

/** `filter` -> per-function utilities, or null if any function is unmappable. */
export function decomposeFilter(value: string, ctx: FunctionsContext): string[] | null {
  const fns = parseFunctionList(value)
  if (!fns) return null
  const classes: string[] = []
  for (const fn of fns) {
    const mapped = filterFn(fn, ctx)
    if (!mapped) return null
    classes.push(mapped)
  }
  return classes.length ? classes : null
}

const GRADIENT_DIRECTIONS: Record<string, string> = {
  'to top': 'to-t',
  'to bottom': 'to-b',
  'to left': 'to-l',
  'to right': 'to-r',
  'to top left': 'to-tl',
  'to left top': 'to-tl',
  'to top right': 'to-tr',
  'to right top': 'to-tr',
  'to bottom left': 'to-bl',
  'to left bottom': 'to-bl',
  'to bottom right': 'to-br',
  'to right bottom': 'to-br',
}

/** A gradient direction keyword/angle -> the `bg-linear-*` suffix (`to right` -> `to-r`, `45deg` -> `45`). */
export function gradientDirection(arg: string): string | null {
  const normalized = arg.trim().toLowerCase().replace(/\s+/g, ' ')
  if (normalized in GRADIENT_DIRECTIONS) return GRADIENT_DIRECTIONS[normalized]
  const deg = degrees(normalized)
  return deg === null ? null : String(deg)
}

/**
 * `background(-image): linear-gradient(...)` -> `bg-linear-<dir> from-… [via-…] to-…`.
 * Only a single `linear-gradient` with 2–3 bare color stops is decomposed; anything
 * else (positions, multiple layers, radial/conic) returns null for the arbitrary fallback.
 */
export function decomposeGradient(value: string, ctx: FunctionsContext): string[] | null {
  const nodes = valueParser(value).nodes.filter((n) => n.type !== 'space')
  if (nodes.length !== 1 || nodes[0].type !== 'function' || nodes[0].value.toLowerCase() !== 'linear-gradient') return null
  if (!ctx.hasRoot('from') || !ctx.hasRoot('to')) return null

  const parts = splitArgs(nodes[0].nodes)
  let direction = 'to-b' // linear-gradient defaults to `to bottom`
  let stops = parts
  const dir = gradientDirection(parts[0])
  if (dir !== null) {
    direction = dir
    stops = parts.slice(1)
  }
  if (stops.length < 2 || stops.length > 3) return null

  const roots = stops.length === 2 ? ['from', 'to'] : ['from', 'via', 'to']
  const classes = [`bg-linear-${direction}`]
  for (let i = 0; i < stops.length; i++) {
    const stop = ctx.colorStop(roots[i], stops[i])
    if (!stop) return null
    classes.push(stop)
  }
  return classes
}
