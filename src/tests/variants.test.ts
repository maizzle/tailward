import { describe, it, expect } from 'vitest'
import { selectorVariants, mediaVariant, type VariantContext } from '../variants.ts'

const ctx: VariantContext = {
  breakpoints: new Map([
    ['40rem', 'sm'],
    ['48rem', 'md'],
    ['64rem', 'lg'],
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
  it('maps a min-width breakpoint', () => {
    expect(mediaVariant('(min-width: 48rem)', ctx)).toBe('md')
  })
  it('maps px min-width to a breakpoint', () => {
    expect(mediaVariant('(min-width: 768px)', ctx)).toBe('md')
  })
  it('falls back to arbitrary min-width', () => {
    expect(mediaVariant('(min-width: 900px)', ctx)).toBe('min-[900px]')
  })
  it('maps prefers-color-scheme dark', () => {
    expect(mediaVariant('(prefers-color-scheme: dark)', ctx)).toBe('dark')
  })
  it('maps print', () => {
    expect(mediaVariant('print', ctx)).toBe('print')
  })
  it('maps max-width to arbitrary', () => {
    expect(mediaVariant('(max-width: 500px)', ctx)).toBe('max-[500px]')
  })
})
