import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadDesignSystem } from '../design-system.ts'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

describe('loadDesignSystem', () => {
  it('loads the stock theme from a bare @import', async () => {
    const ds = await loadDesignSystem()
    expect(ds.getClassList().length).toBeGreaterThan(1000)
    expect(ds.candidatesToCss(['p-4'])[0]).toContain('padding')
  })

  it('honors an inline custom @theme', async () => {
    const ds = await loadDesignSystem('@import "tailwindcss";\n@theme { --color-brand: oklch(55% 0.15 250); }')
    expect(ds.candidatesToCss(['bg-brand'])[0]).toContain('--color-brand')
  })

  it('resolves relative @import statements', async () => {
    const css = readFileSync(join(fixtures, 'entry.css'), 'utf8')
    const ds = await loadDesignSystem(css, fixtures)
    // --color-brand comes from ./brand.css, imported relatively.
    expect(ds.candidatesToCss(['text-brand'])[0]).toContain('--color-brand')
  })

  it('loads a JS plugin via @plugin (loadModule)', async () => {
    const css = readFileSync(join(fixtures, 'with-plugin.css'), 'utf8')
    const ds = await loadDesignSystem(css, fixtures)
    expect(ds.candidatesToCss(['custom-plugin-util'])[0]).toContain('text-align')
  })
})
