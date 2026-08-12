import { normalizeLength } from '../normalize.ts'

/**
 * Reverses a length into a spacing-multiplier utility (e.g. `padding: 3.25rem`
 * with root `p` and base `0.25` -> `p-13`). Only clean integer multiples that
 * aren't already in the reverse index reach here; returns null otherwise.
 */
export function matchSpacing(root: string, value: string, baseRem: number, remInPx: number): string | null {
  const rem = normalizeLength(value, remInPx)
  if (rem === null) return null
  const n = parseFloat(rem) / baseRem
  if (!Number.isInteger(n) || n === 0) return null
  return n < 0 ? `-${root}-${Math.abs(n)}` : `${root}-${n}`
}
