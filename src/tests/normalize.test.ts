import { describe, it, expect } from 'vitest'
import { resolveVars, evalCalc, normalizeLength, normalizeValue, absoluteLineHeight } from '../normalize.ts'

describe('resolveVars', () => {
  const vars = new Map([
    ['--spacing', '0.25rem'],
    ['--color-red-500', 'oklch(63.7% 0.237 25.331)'],
  ])

  it('substitutes a simple var', () => {
    expect(resolveVars('var(--color-red-500)', vars)).toBe('oklch(63.7% 0.237 25.331)')
  })

  it('uses fallback when var is unknown', () => {
    expect(resolveVars('var(--missing, 12px)', vars)).toBe('12px')
  })

  it('resolves vars inside calc', () => {
    expect(resolveVars('calc(var(--spacing) * 4)', vars)).toBe('calc(0.25rem * 4)')
  })
})

describe('evalCalc', () => {
  it('multiplies length by scalar', () => {
    expect(evalCalc('calc(0.25rem * 4)')).toBe('1rem')
  })
  it('handles scalar * length order', () => {
    expect(evalCalc('calc(4 * 0.25rem)')).toBe('1rem')
  })
  it('divides unitless', () => {
    expect(evalCalc('calc(1.5 / 0.875)')).toBe('1.71429')
  })
  it('leaves unknown calc untouched', () => {
    expect(evalCalc('calc(100% - 20px)')).toBe('calc(100% - 20px)')
  })
  it('adds same-unit lengths', () => {
    expect(evalCalc('calc(1rem + 0.5rem)')).toBe('1.5rem')
  })
  it('subtracts same-unit lengths', () => {
    expect(evalCalc('calc(2rem - 0.5rem)')).toBe('1.5rem')
  })
  it('evaluates nested calc', () => {
    expect(evalCalc('calc(calc(0.25rem * 4) * 2)')).toBe('2rem')
  })
  it('leaves mixed-unit addition untouched', () => {
    expect(evalCalc('calc(1rem + 10px)')).toBe('calc(1rem + 10px)')
  })
  it('leaves two-unit multiplication untouched', () => {
    expect(evalCalc('calc(1rem * 2px)')).toBe('calc(1rem * 2px)')
  })
  it('leaves malformed calc untouched', () => {
    expect(evalCalc('calc(1rem *)')).toBe('calc(1rem *)')
  })
  it('passes through values with no calc', () => {
    expect(evalCalc('12px')).toBe('12px')
  })
  it('leaves an unbalanced calc untouched', () => {
    expect(evalCalc('calc(1px + 2px')).toBe('calc(1px + 2px')
  })
  it('leaves nested-but-unevaluable calc untouched', () => {
    expect(evalCalc('calc(calc(100% - 1px) * 2)')).toBe('calc(calc(100% - 1px) * 2)')
  })
  it('leaves division by a unit untouched', () => {
    expect(evalCalc('calc(2rem / 3px)')).toBe('calc(2rem / 3px)')
  })
  it('leaves an unknown operator untouched', () => {
    expect(evalCalc('calc(1rem % 2)')).toBe('calc(1rem % 2)')
  })
})

describe('absoluteLineHeight', () => {
  it('normalizes a length to rem', () => {
    expect(absoluteLineHeight('20px', undefined, 16)).toBe('1.25rem')
    expect(absoluteLineHeight('1.25rem', undefined, 16)).toBe('1.25rem')
  })
  it('resolves a unitless ratio against the font-size', () => {
    expect(absoluteLineHeight('1.5', '16px', 16)).toBe('1.5rem') // 1.5 * 16px = 24px
    expect(absoluteLineHeight('2', '0.875rem', 16)).toBe('1.75rem') // 2 * 14px = 28px
  })
  it('returns null for a ratio with no font-size', () => {
    expect(absoluteLineHeight('1.5', undefined, 16)).toBeNull()
  })
  it('returns null for a keyword', () => {
    expect(absoluteLineHeight('normal', '16px', 16)).toBeNull()
  })
})

describe('normalizeValue', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeValue('  INLINE-Flex  ')).toBe('inline-flex')
    expect(normalizeValue('1px   solid   RED')).toBe('1px solid red')
  })
})

describe('normalizeLength', () => {
  it('keeps rem', () => {
    expect(normalizeLength('1rem', 16)).toBe('1rem')
  })
  it('converts px to rem', () => {
    expect(normalizeLength('12px', 16)).toBe('0.75rem')
  })
  it('normalizes zero', () => {
    expect(normalizeLength('0px', 16)).toBe('0')
  })
  it('rejects non-length', () => {
    expect(normalizeLength('50%', 16)).toBeNull()
  })
})
