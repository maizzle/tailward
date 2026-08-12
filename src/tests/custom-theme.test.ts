import { describe, it, expect, beforeAll } from 'vitest'
import { CssToTailwind } from '../converter.ts'

/**
 * The engine-free `{ theme }` path (edge-safe) must match the live engine for a
 * custom @theme that overrides tokens (colors, spacing, radius).
 */
const THEME = `@theme {
  --color-brand: oklch(55% 0.2 270);
  --color-brand-dark: oklch(40% 0.2 270);
  --spacing: 0.2rem;
  --radius-lg: 1rem;
}`

describe('custom @theme: engine-free === live engine', () => {
  let edge: CssToTailwind
  let live: CssToTailwind

  beforeAll(async () => {
    edge = new CssToTailwind({ remInPx: 16, theme: THEME })
    live = new CssToTailwind({ remInPx: 16, css: `@import "tailwindcss";\n${THEME}` })
    await Promise.all([edge.convert('.x{}'), live.convert('.x{}')])
  }, 60_000)

  const cases = [
    'background-color: oklch(55% 0.2 270)', // -> bg-brand (custom color)
    'color: oklch(40% 0.2 270)', //            -> text-brand-dark
    'padding: 0.2rem', //                       -> p-1 (custom --spacing)
    'padding: 0.4rem', //                       -> p-2
    'margin: 1rem', //                          -> m-5 (1rem / 0.2rem)
    'border-radius: 1rem', //                   -> rounded-lg (custom --radius-lg)
    'color: #fb2c36', //                        -> text-red-500 (stock color, unchanged)
    'display: flex', //                         -> flex (theme-independent)
    'width: 100%', //                           -> w-full (theme-independent)
    'font-weight: 700', //                      -> font-bold (stock token)
  ]

  it('produces identical classes on the edge and live paths', async () => {
    for (const decl of cases) {
      const [a, b] = await Promise.all([edge.convert(`.x{ ${decl} }`), live.convert(`.x{ ${decl} }`)])
      expect(a.nodes[0]?.tailwindClasses, decl).toEqual(b.nodes[0]?.tailwindClasses)
    }
  })

  it('resolves the custom brand color and spacing', async () => {
    expect((await edge.convert('.x{ background-color: oklch(55% 0.2 270) }')).nodes[0].tailwindClasses).toEqual(['bg-brand'])
    expect((await edge.convert('.x{ padding: 0.2rem }')).nodes[0].tailwindClasses).toEqual(['p-1'])
    expect((await edge.convert('.x{ border-radius: 1rem }')).nodes[0].tailwindClasses).toEqual(['rounded-lg'])
  })
})
