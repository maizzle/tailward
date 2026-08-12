import { normalizeLength } from '../normalize.ts'

/**
 * Reverses a length into a spacing-multiplier utility (e.g. `padding: 3.25rem`
 * with root `p` and base `0.25` -> `p-13`, `padding: 0.875rem` -> `p-3.5`).
 * Tailwind v4 accepts any multiplier `N` where `N*4` is an integer (0.25 steps),
 * so this stays correct for a custom `--spacing` too. Returns null otherwise.
 */
export function matchSpacing(root: string, value: string, baseRem: number, remInPx: number): string | null {
  const rem = normalizeLength(value, remInPx)
  if (rem === null) return null
  const n = parseFloat(rem) / baseRem
  if (n === 0) return null
  const quarters = n * 4
  if (Math.abs(quarters - Math.round(quarters)) > 1e-6) return null
  const magnitude = parseFloat((Math.abs(Math.round(quarters)) / 4).toFixed(5)).toString()
  return n < 0 ? `-${root}-${magnitude}` : `${root}-${magnitude}`
}
