import { describe, it, expect } from 'vitest'
import { selectorVariants, mediaVariant, type VariantContext } from '../variants.ts'

// Mixed min-width breakpoints (stock-style) and max-width variants (email-style).
const ctx: VariantContext = {
  mediaVariants: new Map([
    ['(w>=768px)', 'md'],
    ['(w<=600px)', 'sm'],
    ['(w<=430px)', 'xs'],
    ['(prefers-color-scheme:dark)', 'dark'],
    ['print', 'print'],
  ]),
  remInPx: 16,
}

describe('selectorVariants', () => {
  it('extracts a base class with no pseudos', () => {
    expect(selectorVariants('.card')).toEqual({ base: '.card', variants: [] })
  })
  it('maps a single pseudo-class', () => {
    expect(selectorVariants('.card:hover')).toEqual({ base: '.card', variants: ['hover'] })
  })
  it('maps pseudo-elements', () => {
    expect(selectorVariants('.card::before')).toEqual({ base: '.card', variants: ['before'] })
  })
  it('stacks multiple pseudos in order', () => {
    expect(selectorVariants('.card:focus:hover')).toEqual({
      base: '.card',
      variants: ['focus', 'hover'],
    })
  })
  it('leaves unknown pseudos on the base', () => {
    const result = selectorVariants('.card:nth-child(3)')
    expect(result.variants).toEqual([])
  })
})

describe('mediaVariant', () => {
  it('maps a min-width breakpoint (rem or px, same result)', () => {
    expect(mediaVariant('(min-width: 48rem)', ctx)).toBe('md')
    expect(mediaVariant('(min-width: 768px)', ctx)).toBe('md')
  })
  it('maps a max-width query to its exact named variant', () => {
    expect(mediaVariant('(max-width: 430px)', ctx)).toBe('xs')
    expect(mediaVariant('(max-width: 600px)', ctx)).toBe('sm')
  })
  it('stays faithful for an unmatched max-width (never max-[N], which is width<N)', () => {
    expect(mediaVariant('(max-width: 599px)', ctx)).toBe('[@media(max-width:599px)]')
  })
  it('uses min-[N] for an unmatched min-width (equivalent to min-width:N)', () => {
    expect(mediaVariant('(min-width: 900px)', ctx)).toBe('min-[900px]')
  })
  it('maps feature queries', () => {
    expect(mediaVariant('(prefers-color-scheme: dark)', ctx)).toBe('dark')
    expect(mediaVariant('print', ctx)).toBe('print')
  })
  it('ignores a screen prefix', () => {
    expect(mediaVariant('screen and (max-width: 430px)', ctx)).toBe('xs')
  })
})
