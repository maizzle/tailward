import { describe, it, expect, beforeAll } from 'vitest'
import { CssToTailwind } from '../converter.ts'

/**
 * Email presets (e.g. @maizzle/tailwindcss) load utilities via
 * `@import "tailwindcss/utilities" important`, so every generated utility carries
 * `!important`. The index builder must strip it, or nothing matches the input.
 * This also exercises resolving a bare `tailwindcss/theme` subpath to its CSS.
 */
describe('important utility layer', () => {
  let c: CssToTailwind

  beforeAll(async () => {
    c = new CssToTailwind({
      remInPx: 16,
      css: '@import "tailwindcss/theme" source(none);\n@import "tailwindcss/utilities" important;',
    })
    await c.convert('.x{}')
  }, 60_000)

  it('matches declarations despite the important layer', async () => {
    const { nodes } = await c.convert('.a { padding: 1rem; display: flex; }')
    expect(nodes[0].tailwindClasses).toEqual(['flex', 'p-4'])
  })
})
