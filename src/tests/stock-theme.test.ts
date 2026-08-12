import { describe, it, expect, beforeAll } from 'vitest'
import { CssToTailwind } from '../converter.ts'
import { loadDesignSystem } from '../design-system.ts'
import { buildReverseIndex } from '../reverse-index.ts'
import { stockTheme } from '../generated/stock-theme.ts'

/**
 * The embedded (engine-free) path must produce byte-identical output to the live
 * engine. If this fails after a `tailwindcss` bump, run `npm run generate`.
 */
describe('embedded stock theme === live engine', () => {
  let embedded: CssToTailwind
  let live: CssToTailwind
  let entries: [string, string][]

  beforeAll(async () => {
    embedded = new CssToTailwind({ remInPx: 16 }) // default -> embedded
    live = new CssToTailwind({ remInPx: 16, css: '@import "tailwindcss";' }) // -> engine
    await Promise.all([embedded.convert('.x{}'), live.convert('.x{}')])
    const ds = await loadDesignSystem()
    entries = [...buildReverseIndex(ds, 16).decls]
  }, 60_000)

  it('is generated for the installed tailwindcss version', () => {
    const installed = require('tailwindcss/package.json').version
    expect(stockTheme.tailwindVersion).toBe(installed)
  })

  it('produces identical classes for every indexed declaration', async () => {
    const mismatches: string[] = []
    for (const [key] of entries) {
      const i = key.indexOf('|')
      const decl = `${key.slice(0, i)}: ${key.slice(i + 1)}`
      const [a, b] = await Promise.all([
        embedded.convert(`.x{ ${decl} }`),
        live.convert(`.x{ ${decl} }`),
      ])
      const ea = a.nodes[0]?.tailwindClasses.join(' ') ?? ''
      const eb = b.nodes[0]?.tailwindClasses.join(' ') ?? ''
      if (ea !== eb) mismatches.push(`${decl}: embedded=[${ea}] live=[${eb}]`)
    }
    if (mismatches.length) console.error(mismatches.slice(0, 20).join('\n'))
    expect(mismatches).toEqual([])
  }, 120_000)

  it('matches on colors and off-scale values too', async () => {
    const probes = [
      'color: #ff8800', 'background-color: #123456', 'padding: 13px', 'width: 600px',
      'z-index: 60', 'font-size: 20px', 'padding: 0 24px', 'text-decoration: none',
      'line-height: 1.5', 'border-radius: 8px', 'margin: 12px 0 0', 'gap: 5rem',
    ]
    for (const decl of probes) {
      const [a, b] = await Promise.all([
        embedded.convert(`.x{ ${decl} }`),
        live.convert(`.x{ ${decl} }`),
      ])
      expect(a.nodes[0]?.tailwindClasses, decl).toEqual(b.nodes[0]?.tailwindClasses)
    }
  }, 60_000)
})
