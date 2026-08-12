import { describe, it, expect } from 'vitest'
import { toOklab, isColor, alphaOfColor, oklabDistance } from '../color.ts'

describe('isColor', () => {
  it('recognizes formats', () => {
    for (const c of ['#fff', '#ffffff', '#ffffff80', 'rgb(0 0 0)', 'rgba(0,0,0,.5)', 'hsl(0 100% 50%)', 'oklch(63.7% 0.237 25.331)', 'red', 'transparent', 'currentColor']) {
      expect(isColor(c), c).toBe(true)
    }
  })
  it('rejects non-colors', () => {
    for (const v of ['12px', '1.5rem', 'flex', '50%', 'auto', 'notacolor']) {
      expect(isColor(v), v).toBe(false)
    }
  })
})

describe('toOklab', () => {
  it('parses hex shorthand and full', () => {
    expect(toOklab('#f00')).toEqual(toOklab('#ff0000'))
  })
  it('agrees across equivalent formats for red', () => {
    const hex = toOklab('#ff0000')!
    const rgb = toOklab('rgb(255 0 0)')!
    const named = toOklab('red')!
    expect(oklabDistance(hex, rgb)).toBeLessThan(1e-6)
    expect(oklabDistance(hex, named)).toBeLessThan(1e-6)
  })
  it('parses hsl to the same red', () => {
    expect(oklabDistance(toOklab('hsl(0 100% 50%)')!, toOklab('#ff0000')!)).toBeLessThan(1e-6)
  })
  it('parses oklch and oklab', () => {
    const a = toOklab('oklch(63.7% 0.237 25.331)')!
    const b = toOklab('oklab(0.637 0.214 0.101)')!
    expect(oklabDistance(a, b)).toBeLessThan(0.02)
  })
  it('handles percentage rgb channels', () => {
    expect(oklabDistance(toOklab('rgb(100% 0% 0%)')!, toOklab('#ff0000')!)).toBeLessThan(1e-6)
  })
  it('returns null for currentColor and invalid input', () => {
    expect(toOklab('currentColor')).toBeNull()
    expect(toOklab('#xyz')).toBeNull()
    expect(toOklab('rgb(1 2)')).toBeNull()
    expect(toOklab('notacolor')).toBeNull()
  })
})

describe('alphaOfColor', () => {
  it('reads alpha from hex8, rgba, and slash syntax', () => {
    expect(alphaOfColor('#ff000080')).toBeCloseTo(128 / 255, 2)
    expect(alphaOfColor('rgba(0,0,0,0.5)')).toBe(0.5)
    expect(alphaOfColor('rgb(0 0 0 / 25%)')).toBe(0.25)
    expect(alphaOfColor('transparent')).toBe(0)
    expect(alphaOfColor('#fff')).toBe(1)
  })
})
