import { describe, it, expect, beforeAll } from 'vitest'
import { loadDesignSystem, type DesignSystem } from '../design-system.ts'
import { buildReverseIndex, declKey, type ReverseIndex } from '../reverse-index.ts'

let ds: DesignSystem
let index: ReverseIndex

beforeAll(async () => {
  ds = await loadDesignSystem()
  index = buildReverseIndex(ds, 16)
}, 60_000)

describe('reverse index', () => {
  it('maps static utilities', () => {
    expect(index.decls.get(declKey('display', 'flex', 16))).toBe('flex')
    expect(index.decls.get(declKey('display', 'block', 16))).toBe('block')
  })

  it('maps spacing via rem', () => {
    expect(index.decls.get(declKey('padding', '1rem', 16))).toBe('p-4')
    expect(index.decls.get(declKey('margin', '0.5rem', 16))).toBe('m-2')
  })

  it('maps px input to rem-based spacing', () => {
    expect(index.decls.get(declKey('padding', '16px', 16))).toBe('p-4')
    expect(index.decls.get(declKey('padding', '12px', 16))).toBe('p-3')
  })

  it('maps named tokens like radius', () => {
    expect(index.decls.get(declKey('border-radius', '0.5rem', 16))).toBe('rounded-lg')
  })

  it('derives property -> root map', () => {
    expect(index.propToRoot.get('padding')).toBe('p')
    expect(index.propToRoot.get('margin')).toBe('m')
    expect(index.propToRoot.get('width')).toBe('w')
  })

  it('derives color roots', () => {
    expect(index.colorRoots.get('color')).toBe('text')
    expect(index.colorRoots.get('background-color')).toBe('bg')
  })

  it('exposes the palette', () => {
    expect(index.palette.get('red-500')).toContain('oklch')
    expect(index.palette.has('white')).toBe(true)
  })
})
