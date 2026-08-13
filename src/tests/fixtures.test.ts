import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CssToTailwind } from '../converter.ts'

const here = dirname(fileURLToPath(import.meta.url))
let c: CssToTailwind

beforeAll(async () => {
  c = new CssToTailwind({ remInPx: 16 })
  await c.convert('.x{}')
}, 60_000)

describe('realistic stylesheet', () => {
  it('converts a full stylesheet', async () => {
    const css = readFileSync(join(here, 'fixtures/input.css'), 'utf8')
    const { nodes } = await c.convert(css)
    expect(nodes).toMatchInlineSnapshot(`
      [
        {
          "complementary": "",
          "selector": ".button",
          "tailwindClasses": [
            "mt-4",
            "inline-flex",
            "rounded-md",
            "bg-red-500",
            "px-4",
            "py-2",
            "font-semibold",
            "text-white",
          ],
        },
        {
          "complementary": "",
          "selector": ".button",
          "tailwindClasses": [
            "hover:bg-red-600",
          ],
        },
        {
          "complementary": "",
          "selector": ".button",
          "tailwindClasses": [
            "md:px-8",
          ],
        },
        {
          "complementary": "",
          "selector": ".card",
          "tailwindClasses": [
            "w-full",
            "gap-3",
            "[animation-timeline:scroll()]",
          ],
        },
      ]
    `)
  })
})
