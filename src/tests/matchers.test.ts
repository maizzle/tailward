import { describe, it, expect } from 'vitest'
import { createColorMatcher } from '../matchers/color.ts'
import { arbitraryUtility, arbitraryProperty } from '../matchers/arbitrary.ts'
import { matchSpacing } from '../matchers/spacing.ts'

describe('color matcher', () => {
  const palette = new Map([
    ['red-500', 'oklch(63.7% 0.237 25.331)'],
    ['white', '#fff'],
    ['black', '#000'],
  ])
  const m = createColorMatcher(palette)

  it('maps the transparent keyword', () => {
    expect(m.match('bg', 'transparent', 0.02)).toBe('bg-transparent')
  })
  it('maps currentColor (case-insensitive)', () => {
    expect(m.match('text', 'currentColor', 0.02)).toBe('text-current')
  })
  it('returns null for an invalid color', () => {
    expect(m.match('text', 'not-a-color', 0.02)).toBeNull()
  })
  it('defers translucent colors to arbitrary', () => {
    expect(m.match('bg', 'rgba(255,0,0,0.5)', 0.02)).toBeNull()
  })
  it('matches an exact palette color', () => {
    expect(m.match('text', 'oklch(63.7% 0.237 25.331)', 0.02)).toBe('text-red-500')
  })
  it('returns null when nothing is within threshold', () => {
    expect(m.match('bg', '#00ff00', 0)).toBeNull()
  })
  it('matches white/black', () => {
    expect(m.match('bg', '#ffffff', 0.02)).toBe('bg-white')
  })
})

describe('arbitrary utilities', () => {
  it('wraps a plain value in brackets', () => {
    expect(arbitraryUtility('p', '13px')).toBe('p-[13px]')
  })
  it('uses the v4 CSS-variable shorthand for bare vars', () => {
    expect(arbitraryUtility('fill', 'var(--brand)')).toBe('fill-(--brand)')
  })
  it('escapes whitespace as underscores', () => {
    expect(arbitraryUtility('p', '10px 20px')).toBe('p-[10px_20px]')
  })
  it('escapes literal underscores', () => {
    expect(arbitraryUtility('bg', 'url(a_b.png)')).toBe('bg-[url(a\\_b.png)]')
  })
  it('builds arbitrary properties', () => {
    expect(arbitraryProperty('mask-type', 'luminance')).toBe('[mask-type:luminance]')
  })
})

describe('spacing matcher', () => {
  it('reverses a clean integer multiple', () => {
    expect(matchSpacing('p', '3.25rem', 0.25, 16)).toBe('p-13')
  })
  it('reverses px against the rem base', () => {
    expect(matchSpacing('m', '52px', 0.25, 16)).toBe('m-13')
  })
  it('handles negative multiples', () => {
    expect(matchSpacing('mt', '-1rem', 0.25, 16)).toBe('-mt-4')
  })
  it('returns null for non-integer multiples', () => {
    expect(matchSpacing('p', '13px', 0.25, 16)).toBeNull()
  })
  it('returns null for non-length values', () => {
    expect(matchSpacing('p', 'auto', 0.25, 16)).toBeNull()
  })
})
