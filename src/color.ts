/**
 * Minimal, dependency-free color parsing + OKLab conversion.
 *
 * Replaces culori on the hot path: culori costs ~25ms just to import, which
 * dominated cold start. We only need to (a) detect colors, (b) convert to OKLab,
 * and (c) measure OKLab distance for palette matching — all standard formulas.
 */

export interface Oklab {
  L: number
  a: number
  b: number
}

interface Rgb {
  r: number
  g: number
  b: number
  alpha: number
}

// CSS named colors (sRGB hex). Covers the CSS Color 4 list.
const NAMED: Record<string, string> = {
  aliceblue: 'f0f8ff', antiquewhite: 'faebd7', aqua: '00ffff', aquamarine: '7fffd4', azure: 'f0ffff',
  beige: 'f5f5dc', bisque: 'ffe4c4', black: '000000', blanchedalmond: 'ffebcd', blue: '0000ff',
  blueviolet: '8a2be2', brown: 'a52a2a', burlywood: 'deb887', cadetblue: '5f9ea0', chartreuse: '7fff00',
  chocolate: 'd2691e', coral: 'ff7f50', cornflowerblue: '6495ed', cornsilk: 'fff8dc', crimson: 'dc143c',
  cyan: '00ffff', darkblue: '00008b', darkcyan: '008b8b', darkgoldenrod: 'b8860b', darkgray: 'a9a9a9',
  darkgreen: '006400', darkgrey: 'a9a9a9', darkkhaki: 'bdb76b', darkmagenta: '8b008b', darkolivegreen: '556b2f',
  darkorange: 'ff8c00', darkorchid: '9932cc', darkred: '8b0000', darksalmon: 'e9967a', darkseagreen: '8fbc8f',
  darkslateblue: '483d8b', darkslategray: '2f4f4f', darkslategrey: '2f4f4f', darkturquoise: '00ced1',
  darkviolet: '9400d3', deeppink: 'ff1493', deepskyblue: '00bfff', dimgray: '696969', dimgrey: '696969',
  dodgerblue: '1e90ff', firebrick: 'b22222', floralwhite: 'fffaf0', forestgreen: '228b22', fuchsia: 'ff00ff',
  gainsboro: 'dcdcdc', ghostwhite: 'f8f8ff', gold: 'ffd700', goldenrod: 'daa520', gray: '808080',
  green: '008000', greenyellow: 'adff2f', grey: '808080', honeydew: 'f0fff0', hotpink: 'ff69b4',
  indianred: 'cd5c5c', indigo: '4b0082', ivory: 'fffff0', khaki: 'f0e68c', lavender: 'e6e6fa',
  lavenderblush: 'fff0f5', lawngreen: '7cfc00', lemonchiffon: 'fffacd', lightblue: 'add8e6', lightcoral: 'f08080',
  lightcyan: 'e0ffff', lightgoldenrodyellow: 'fafad2', lightgray: 'd3d3d3', lightgreen: '90ee90', lightgrey: 'd3d3d3',
  lightpink: 'ffb6c1', lightsalmon: 'ffa07a', lightseagreen: '20b2aa', lightskyblue: '87cefa', lightslategray: '778899',
  lightslategrey: '778899', lightsteelblue: 'b0c4de', lightyellow: 'ffffe0', lime: '00ff00', limegreen: '32cd32',
  linen: 'faf0e6', magenta: 'ff00ff', maroon: '800000', mediumaquamarine: '66cdaa', mediumblue: '0000cd',
  mediumorchid: 'ba55d3', mediumpurple: '9370db', mediumseagreen: '3cb371', mediumslateblue: '7b68ee',
  mediumspringgreen: '00fa9a', mediumturquoise: '48d1cc', mediumvioletred: 'c71585', midnightblue: '191970',
  mintcream: 'f5fffa', mistyrose: 'ffe4e1', moccasin: 'ffe4b5', navajowhite: 'ffdead', navy: '000080',
  oldlace: 'fdf5e6', olive: '808000', olivedrab: '6b8e23', orange: 'ffa500', orangered: 'ff4500',
  orchid: 'da70d6', palegoldenrod: 'eee8aa', palegreen: '98fb98', paleturquoise: 'afeeee', palevioletred: 'db7093',
  papayawhip: 'ffefd5', peachpuff: 'ffdab9', peru: 'cd853f', pink: 'ffc0cb', plum: 'dda0dd',
  powderblue: 'b0e0e6', purple: '800080', rebeccapurple: '663399', red: 'ff0000', rosybrown: 'bc8f8f',
  royalblue: '4169e1', saddlebrown: '8b4513', salmon: 'fa8072', sandybrown: 'f4a460', seagreen: '2e8b57',
  seashell: 'fff5ee', sienna: 'a0522d', silver: 'c0c0c0', skyblue: '87ceeb', slateblue: '6a5acd',
  slategray: '708090', slategrey: '708090', snow: 'fffafa', springgreen: '00ff7f', steelblue: '4682b4',
  tan: 'd2b48c', teal: '008080', thistle: 'd8bfd8', tomato: 'ff6347', turquoise: '40e0d0',
  violet: 'ee82ee', wheat: 'f5deb3', white: 'ffffff', whitesmoke: 'f5f5f5', yellow: 'ffff00', yellowgreen: '9acd32',
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)
const num = (s: string) => parseFloat(s)
/** Parses `50%` or `0.5` / `128` (with `max` for the non-percent scale). */
function channel(s: string, max: number): number {
  s = s.trim()
  if (s.endsWith('%')) return clamp01(num(s) / 100)
  return clamp01(num(s) / max)
}
function alphaOf(s: string | undefined): number {
  if (s === undefined) return 1
  s = s.trim()
  return clamp01(s.endsWith('%') ? num(s) / 100 : num(s))
}

function parseHex(hex: string): Rgb | null {
  let h = hex.slice(1)
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('')
  if (h.length !== 6 && h.length !== 8) return null
  if (!/^[0-9a-f]+$/i.test(h)) return null
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
  return { r, g, b, alpha }
}

/** Splits `a b c` or `a, b, c` (optionally `... / alpha`) into components. */
function args(inner: string): { parts: string[]; alpha?: string } {
  const [main, alpha] = inner.split('/')
  const parts = main.trim().split(/[\s,]+/).filter(Boolean)
  return { parts, alpha: alpha?.trim() ?? (parts.length === 4 ? parts.pop() : undefined) }
}

function hslToRgb(h: number, s: number, l: number, alpha: number): Rgb {
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return { r: r + m, g: g + m, b: b + m, alpha }
}

const cbrt = Math.cbrt
function srgbToOklab({ r, g, b }: Rgb): Oklab {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const R = lin(r), G = lin(g), B = lin(b)
  const l = cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

function oklchToOklab(L: number, C: number, h: number): Oklab {
  const rad = (h * Math.PI) / 180
  return { L, a: C * Math.cos(rad), b: C * Math.sin(rad) }
}

/** Parses any supported CSS color to OKLab, or null if not a color. */
export function toOklab(input: string): Oklab | null {
  const v = input.trim().toLowerCase()
  if (v === 'transparent') return { L: 0, a: 0, b: 0 }
  if (v === 'currentcolor') return null

  if (v[0] === '#') {
    const rgb = parseHex(v)
    return rgb ? srgbToOklab(rgb) : null
  }
  const fn = /^([a-z]+)\((.*)\)$/.exec(v)
  if (fn) {
    const [, name, inner] = fn
    const { parts, alpha } = args(inner)
    void alpha
    if (name === 'rgb' || name === 'rgba') {
      if (parts.length < 3) return null
      return srgbToOklab({ r: channel(parts[0], 255), g: channel(parts[1], 255), b: channel(parts[2], 255), alpha: 1 })
    }
    if (name === 'hsl' || name === 'hsla') {
      if (parts.length < 3) return null
      return srgbToOklab(hslToRgb(num(parts[0]), channel(parts[1], 100), channel(parts[2], 100), 1))
    }
    if (name === 'oklch') {
      if (parts.length < 3) return null
      return oklchToOklab(channel(parts[0], 1), num(parts[1]), num(parts[2]))
    }
    if (name === 'oklab') {
      if (parts.length < 3) return null
      return { L: channel(parts[0], 1), a: num(parts[1]), b: num(parts[2]) }
    }
    return null
  }
  const hex = NAMED[v]
  return hex ? srgbToOklab(parseHex('#' + hex)!) : null
}

/** Returns the alpha channel of a color (1 if opaque / unparseable). */
export function alphaOfColor(input: string): number {
  const v = input.trim().toLowerCase()
  if (v === 'transparent') return 0
  if (v[0] === '#') return parseHex(v)?.alpha ?? 1
  const fn = /^[a-z]+\((.*)\)$/.exec(v)
  if (fn) return alphaOf(args(fn[1]).alpha)
  return 1
}

/** Is this string a color we understand? */
export function isColor(input: string): boolean {
  const v = input.trim().toLowerCase()
  if (v === 'transparent' || v === 'currentcolor') return true
  if (/^-?\d/.test(v)) return false
  return toOklab(v) !== null || v in NAMED
}

/** Euclidean distance in OKLab. */
export function oklabDistance(a: Oklab, b: Oklab): number {
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b)
}
