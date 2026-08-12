import { parse as colorParse, converter, differenceEuclidean } from 'culori'

const toOklab = converter('oklab')
const distance = differenceEuclidean('oklab')

export interface ColorMatcher {
  match(root: string, value: string, threshold: number): string | null
}

/** Builds a color matcher over a palette of `token -> color string`. */
export function createColorMatcher(palette: Map<string, string>): ColorMatcher {
  // Pre-parse palette colors once.
  const parsed: { token: string; color: NonNullable<ReturnType<typeof toOklab>> }[] = []
  for (const [token, value] of palette) {
    const c = colorParse(value)
    const oklab = c && toOklab(c)
    if (oklab) parsed.push({ token, color: oklab })
  }

  return {
    match(root, value, threshold) {
      const v = value.trim().toLowerCase()
      if (v === 'transparent') return `${root}-transparent`
      if (v === 'currentcolor') return `${root}-current`

      const input = colorParse(v)
      if (!input) return null
      // Alpha channels don't round-trip cleanly to a bare token; defer to arbitrary.
      if (input.alpha !== undefined && input.alpha !== 1) return null

      const target = toOklab(input)
      if (!target) return null
      let best: string | null = null
      let bestDist = Infinity
      for (const entry of parsed) {
        const d = distance(target, entry.color)
        if (d < bestDist) {
          bestDist = d
          best = entry.token
        }
      }
      if (best === null || bestDist > threshold) return null
      return `${root}-${best}`
    },
  }
}
