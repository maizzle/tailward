import { describe, it, expect, beforeAll } from 'vitest'
import { CssToTailwind } from '../converter.ts'

let c: CssToTailwind

beforeAll(async () => {
  c = new CssToTailwind({ remInPx: 16 })
  await c.convert('.x{}')
}, 60_000)

describe('warnings', () => {
  it('is empty when everything converts exactly', async () => {
    const { warnings } = await c.convert('.a { display: flex; padding: 1rem; color: #fb2c36; }')
    expect(warnings).toEqual([]) // #fb2c36 is the canonical sRGB of red-500 (ΔE ~0.001)
  })

  it('flags approximated colors with the class and distance', async () => {
    // A loose threshold forces a nearest-but-inexact match.
    const loose = new CssToTailwind({ colorThreshold: 0.2 })
    const { nodes, warnings } = await loose.convert('.a { color: #ff5588; }')
    expect(nodes[0].tailwindClasses).toHaveLength(1) // still converts to nearest
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ type: 'approximate-color', selector: '.a', declaration: 'color: #ff5588' })
    expect(warnings[0].message).toMatch(/approximated #ff5588 to text-\S+ \(ΔE 0\.\d+\)/)
  })

  it('does not warn for exact palette colors', async () => {
    const { warnings } = await c.convert('.a { background-color: oklch(63.7% 0.237 25.331); }')
    expect(warnings).toEqual([])
  })

  it('does not warn for arbitrary values (they are exact)', async () => {
    const exact = new CssToTailwind({ colorThreshold: 0 }) // only exact palette matches
    const { nodes, warnings } = await exact.convert('.a { color: #123abc; }')
    expect(nodes[0].tailwindClasses[0]).toMatch(/^text-\[/) // arbitrary, exact
    expect(warnings).toEqual([])
  })

  it('flags unconvertible declarations', async () => {
    const strict = new CssToTailwind({ arbitrary: false })
    const { warnings } = await strict.convert('.a { animation-timeline: view(); }')
    expect(warnings).toEqual([
      {
        type: 'unconvertible',
        selector: '.a',
        declaration: 'animation-timeline: view()',
        message: 'no Tailwind utility for "animation-timeline: view()"',
      },
    ])
  })

  it('reports the selector each warning came from', async () => {
    const loose = new CssToTailwind({ colorThreshold: 0.2, arbitrary: false })
    const { warnings } = await loose.convert(`
      .a { color: #ff5588; }
      .b { animation-timeline: view(); }
    `)
    expect(warnings.map((w) => [w.selector, w.type])).toEqual([
      ['.a', 'approximate-color'],
      ['.b', 'unconvertible'],
    ])
  })
})
