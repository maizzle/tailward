import { describe, it, expect } from 'vitest'
import { parseThemeTokens, themeMediaVariants } from '../embedded.ts'

describe('parseThemeTokens', () => {
  it('splits color tokens from other theme vars and ignores non-custom props', () => {
    const { vars, colors } = parseThemeTokens(
      '@theme { --color-brand: #123456; --spacing: 0.2rem; } .foo { color: blue }',
    )
    expect(colors).toEqual({ brand: '#123456' })
    expect(vars).toEqual({ '--spacing': '0.2rem' })
  })
})

describe('themeMediaVariants', () => {
  it('rebuilds min-width breakpoints from --breakpoint tokens over the stock features', () => {
    const map = themeMediaVariants('@theme { --breakpoint-sm: 700px; }', 16)
    expect(map.get('(w>=700px)')).toBe('sm') // overridden breakpoint
    expect(map.get('(prefers-color-scheme:dark)')).toBe('dark') // stock feature kept
  })
})
