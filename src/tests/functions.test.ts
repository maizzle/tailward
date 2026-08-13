import { describe, it, expect } from 'vitest'
import {
  parseFunctionList,
  amountToPercent,
  degrees,
  gradientDirection,
  decomposeTransform,
  decomposeFilter,
  decomposeGradient,
  type FunctionsContext,
} from '../matchers/functions.ts'

// A predictable stand-in for the real index-backed context.
const ctx: FunctionsContext = {
  spacing: (root, len) => {
    const map: Record<string, string> = { '10px': '2.5', '20px': '5', '-1rem': '-4' }
    return map[len] ? `${root}-${map[len]}` : null
  },
  blurToken: (len) => ({ '4px': 'xs', '8px': 'sm' })[len] ?? null,
  colorStop: (root, color) => (/^#|^rgb|^oklch/.test(color) ? `${root}-C` : null),
  hasRoot: () => true,
}

describe('parseFunctionList', () => {
  it('parses a whitespace-separated function list', () => {
    expect(parseFunctionList('translateX(10px) rotate(45deg)')).toEqual([
      { name: 'translatex', args: ['10px'] },
      { name: 'rotate', args: ['45deg'] },
    ])
  })
  it('splits multi-argument functions on commas', () => {
    expect(parseFunctionList('translate(10px, 20px)')).toEqual([{ name: 'translate', args: ['10px', '20px'] }])
  })
  it('returns null for a bare keyword or non-function token', () => {
    expect(parseFunctionList('none')).toBeNull()
    expect(parseFunctionList('10px blur(4px)')).toBeNull() // a bare word disqualifies the list
  })
})

describe('amountToPercent', () => {
  it('treats a unitless number as a ratio and a % as literal', () => {
    expect(amountToPercent('1.5')).toBe(150)
    expect(amountToPercent('150%')).toBe(150)
    expect(amountToPercent('0.5')).toBe(50)
  })
  it('rejects fractional percentages and non-numbers', () => {
    expect(amountToPercent('1.234')).toBeNull()
    expect(amountToPercent('abc')).toBeNull()
  })
})

describe('degrees', () => {
  it('reads whole degrees, signed', () => {
    expect(degrees('45deg')).toBe(45)
    expect(degrees('-45deg')).toBe(-45)
  })
  it('rejects non-integer or unit-less angles', () => {
    expect(degrees('1.5deg')).toBeNull()
    expect(degrees('45')).toBeNull()
  })
})

describe('gradientDirection', () => {
  it('maps keyword directions', () => {
    expect(gradientDirection('to right')).toBe('to-r')
    expect(gradientDirection('to bottom left')).toBe('to-bl')
    expect(gradientDirection('to  LEFT  top')).toBe('to-tl')
  })
  it('maps an angle to a bare number', () => {
    expect(gradientDirection('45deg')).toBe('45')
  })
  it('returns null for anything else', () => {
    expect(gradientDirection('#fff')).toBeNull()
  })
})

describe('decomposeTransform', () => {
  it('maps translate, scale, rotate, and skew functions', () => {
    expect(decomposeTransform('translateX(10px)', ctx)).toEqual(['translate-x-2.5'])
    expect(decomposeTransform('translate(10px,20px)', ctx)).toEqual(['translate-x-2.5', 'translate-y-5'])
    expect(decomposeTransform('scale(1.5)', ctx)).toEqual(['scale-150'])
    expect(decomposeTransform('scale(1.5,2)', ctx)).toEqual(['scale-x-150', 'scale-y-200'])
    expect(decomposeTransform('translateY(20px)', ctx)).toEqual(['translate-y-5'])
    expect(decomposeTransform('translateZ(10px)', ctx)).toEqual(['translate-z-2.5'])
    expect(decomposeTransform('scaleX(0.5)', ctx)).toEqual(['scale-x-50'])
    expect(decomposeTransform('scaleY(0.5)', ctx)).toEqual(['scale-y-50'])
    expect(decomposeTransform('rotate(-45deg)', ctx)).toEqual(['-rotate-45'])
    expect(decomposeTransform('skewX(6deg)', ctx)).toEqual(['skew-x-6'])
    expect(decomposeTransform('skewY(3deg)', ctx)).toEqual(['skew-y-3'])
    expect(decomposeTransform('skew(6deg,3deg)', ctx)).toEqual(['skew-x-6', 'skew-y-3'])
    expect(decomposeTransform('skew(6deg,6deg)', ctx)).toEqual(['skew-6'])
    expect(decomposeTransform('translateX(10px) rotate(45deg)', ctx)).toEqual(['translate-x-2.5', 'rotate-45'])
  })
  it('returns null when any function is unmappable', () => {
    expect(decomposeTransform('translateX(13px)', ctx)).toBeNull() // spacing miss
    expect(decomposeTransform('perspective(500px)', ctx)).toBeNull() // unknown fn
    expect(decomposeTransform('rotate(1.5deg)', ctx)).toBeNull() // non-integer
    expect(decomposeTransform('none', ctx)).toBeNull()
  })
})

describe('decomposeFilter', () => {
  it('maps blur, percentage, and angle filter functions', () => {
    expect(decomposeFilter('blur(4px)', ctx)).toEqual(['blur-xs'])
    expect(decomposeFilter('brightness(1.5)', ctx)).toEqual(['brightness-150'])
    expect(decomposeFilter('grayscale(100%)', ctx)).toEqual(['grayscale'])
    expect(decomposeFilter('grayscale(50%)', ctx)).toEqual(['grayscale-50'])
    expect(decomposeFilter('invert(1)', ctx)).toEqual(['invert'])
    expect(decomposeFilter('sepia(100%)', ctx)).toEqual(['sepia'])
    expect(decomposeFilter('contrast(1.25)', ctx)).toEqual(['contrast-125'])
    expect(decomposeFilter('saturate(1.5)', ctx)).toEqual(['saturate-150'])
    expect(decomposeFilter('hue-rotate(-15deg)', ctx)).toEqual(['-hue-rotate-15'])
    expect(decomposeFilter('blur(4px) brightness(1.5)', ctx)).toEqual(['blur-xs', 'brightness-150'])
  })
  it('returns null on an off-scale blur, negative amount, or unknown function', () => {
    expect(decomposeFilter('blur(3px)', ctx)).toBeNull()
    expect(decomposeFilter('brightness(-1)', ctx)).toBeNull()
    expect(decomposeFilter('opacity(0.5)', ctx)).toBeNull()
  })
})

describe('decomposeGradient', () => {
  it('decomposes a 2-stop linear gradient with an explicit direction', () => {
    expect(decomposeGradient('linear-gradient(to right, #fb2c36, #155dfc)', ctx)).toEqual([
      'bg-linear-to-r',
      'from-C',
      'to-C',
    ])
  })
  it('defaults to to-b and supports a via stop', () => {
    expect(decomposeGradient('linear-gradient(#000, #888, #fff)', ctx)).toEqual(['bg-linear-to-b', 'from-C', 'via-C', 'to-C'])
  })
  it('accepts an angle direction', () => {
    expect(decomposeGradient('linear-gradient(45deg, #000, #fff)', ctx)).toEqual(['bg-linear-45', 'from-C', 'to-C'])
  })
  it('returns null for non-linear, too many stops, or an unmatchable stop', () => {
    expect(decomposeGradient('radial-gradient(#000, #fff)', ctx)).toBeNull()
    expect(decomposeGradient('linear-gradient(#1, #2, #3, #4)', ctx)).toBeNull()
    expect(decomposeGradient('linear-gradient(to right, red, blue)', ctx)).toBeNull() // keyword colors unmatched
  })
  it('returns null when the theme lacks gradient roots', () => {
    expect(decomposeGradient('linear-gradient(#000,#fff)', { ...ctx, hasRoot: () => false })).toBeNull()
  })
})
