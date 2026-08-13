import { toOklab, alphaOfColor, oklabDistance, type Oklab } from '../color.ts'

export interface ColorMatch {
  className: string
  /** OKLab distance to the matched palette color (0 = exact keyword/token). */
  distance: number
}

export interface ColorMatcher {
  match(root: string, value: string, threshold: number): ColorMatch | null
}

/** Builds a color matcher over a palette of `token -> color string`. */
export function createColorMatcher(palette: Map<string, string>): ColorMatcher {
  // Pre-parse palette colors once.
  const parsed: { token: string; color: Oklab }[] = []
  for (const [token, value] of palette) {
    const c = toOklab(value)
    if (c) parsed.push({ token, color: c })
  }

  return {
    match(root, value, threshold) {
      const v = value.trim().toLowerCase()
      if (v === 'transparent') return { className: `${root}-transparent`, distance: 0 }
      if (v === 'currentcolor') return { className: `${root}-current`, distance: 0 }

      // Alpha channels don't round-trip cleanly to a bare token; defer to arbitrary.
      if (alphaOfColor(v) !== 1) return null

      const target = toOklab(v)
      if (!target) return null
      let best: string | null = null
      let bestDist = Infinity
      for (const entry of parsed) {
        const d = oklabDistance(target, entry.color)
        if (d < bestDist) {
          bestDist = d
          best = entry.token
        }
      }
      if (best === null || bestDist > threshold) return null
      return { className: `${root}-${best}`, distance: bestDist }
    },
  }
}
