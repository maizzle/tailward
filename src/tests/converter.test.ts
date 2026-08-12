import { describe, it, expect, beforeAll } from 'vitest'
import { CssToTailwind } from '../converter.ts'
import { convertCss } from '../index.ts'

let c: CssToTailwind

beforeAll(async () => {
  c = new CssToTailwind({ remInPx: 16 })
  // Warm the index once.
  await c.convert('.x{}')
}, 60_000)

async function classesFor(css: string): Promise<string[]> {
  const { nodes } = await c.convert(css)
  return nodes[0]?.tailwindClasses ?? []
}

describe('CssToTailwind', () => {
  it('converts a basic declaration block', async () => {
    expect(await classesFor('.a { display: flex; padding: 1rem; }')).toEqual(['flex', 'p-4'])
  })

  it('converts px lengths against the rem scale', async () => {
    expect(await classesFor('.a { margin: 8px; }')).toEqual(['m-2'])
  })

  it('reverses out-of-scale spacing multiples', async () => {
    // 3.25rem / 0.25rem = 13 -> p-13 (not a named token)
    expect(await classesFor('.a { padding: 3.25rem; }')).toEqual(['p-13'])
  })

  it('matches exact palette colors', async () => {
    // v4 red-500 is oklch(63.7% 0.237 25.331).
    expect(await classesFor('.a { color: oklch(63.7% 0.237 25.331); }')).toEqual(['text-red-500'])
    expect(await classesFor('.a { background-color: oklch(63.7% 0.237 25.331); }')).toEqual([
      'bg-red-500',
    ])
  })

  it('matches near palette colors within threshold', async () => {
    // #fb2c36 is the sRGB rendering of v4 red-500.
    expect(await classesFor('.a { color: #fb2c36; }')).toEqual(['text-red-500'])
  })

  it('reverses 0.25-step spacing, arbitrary only when off-scale', async () => {
    expect(await classesFor('.a { padding: 13px; }')).toEqual(['p-3.25']) // 13/4 = 3.25
    expect(await classesFor('.a { padding: 13.7px; }')).toEqual(['p-[13.7px]']) // not a .25 step
  })

  it('emits arbitrary colors when exact matching is required', async () => {
    const c2 = new CssToTailwind({ colorThreshold: 0 })
    const { nodes } = await c2.convert('.a { color: #123abc; }')
    expect(nodes[0].tailwindClasses).toEqual(['text-[#123abc]'])
  })

  it('handles named tokens', async () => {
    expect(await classesFor('.a { border-radius: 0.5rem; font-weight: 700; }')).toEqual([
      'rounded-lg',
      'font-bold',
    ])
  })

  it('maps media queries to responsive variants', async () => {
    const classes = await classesFor('@media (min-width: 48rem) { .a { display: flex; } }')
    expect(classes).toEqual(['md:flex'])
  })

  it('maps pseudo-classes to variants', async () => {
    expect(await classesFor('.a:hover { color: #fb2c36; }')).toEqual(['hover:text-red-500'])
  })

  it('keeps unconvertible declarations as complementary CSS', async () => {
    const c2 = new CssToTailwind({ arbitrary: false })
    const { nodes } = await c2.convert('.a { animation-timeline: view(); }')
    expect(nodes[0].tailwindClasses).toEqual([])
    expect(nodes[0].complementary).toContain('animation-timeline')
  })

  it('convertCss convenience works', async () => {
    const { nodes } = await convertCss('.a { display: block; }')
    expect(nodes[0].tailwindClasses).toEqual(['block'])
  })

  it('collapses arbitrary utilities into dynamic named ones', async () => {
    expect(await classesFor('.a { z-index: 60; }')).toEqual(['z-60'])
    expect(await classesFor('.a { order: 13; }')).toEqual(['order-13'])
  })

  it('keeps arbitrary values that have no named equivalent', async () => {
    expect(await classesFor('.a { width: 33.333337%; }')).toEqual(['w-[33.333337%]'])
    expect(await classesFor('.a { padding: 13.7px; }')).toEqual(['p-[13.7px]'])
  })

  it('can opt out of canonicalization', async () => {
    const c2 = new CssToTailwind({ canonicalize: false })
    const { nodes } = await c2.convert('.a { z-index: 60; }')
    expect(nodes[0].tailwindClasses).toEqual(['z-[60]'])
  })

  it('maps text-decoration shorthand keywords', async () => {
    expect(await classesFor('.a { text-decoration: none; }')).toEqual(['no-underline'])
    expect(await classesFor('.a { text-decoration: underline; }')).toEqual(['underline'])
    expect(await classesFor('.a { text-decoration: line-through; }')).toEqual(['line-through'])
  })

  it('maps font-size to the text scale', async () => {
    expect(await classesFor('.a { font-size: 20px; }')).toEqual(['text-xl'])
    expect(await classesFor('.a { font-size: 1rem; }')).toEqual(['text-base'])
  })

  it('falls back to arbitrary font-size off-scale', async () => {
    expect(await classesFor('.a { font-size: 13px; }')).toEqual(['text-[13px]'])
  })

  it('decomposes box shorthands into axis/directional utilities', async () => {
    expect(await classesFor('.a { padding: 0 24px; }')).toEqual(['px-6', 'py-0'])
    expect(await classesFor('.a { padding: 8px 16px; }')).toEqual(['px-4', 'py-2'])
    expect(await classesFor('.a { margin: 12px 0 0; }')).toEqual(['mx-0', 'mt-3', 'mb-0'])
    expect(await classesFor('.a { margin: 10px 20px 30px 40px; }')).toEqual([
      'mt-2.5', 'mr-5', 'mb-7.5', 'ml-10',
    ])
  })

  it('resolves fractional spacing steps in shorthands', async () => {
    expect(await classesFor('.a { padding: 14px 20px; }')).toEqual(['px-5', 'py-3.5'])
    expect(await classesFor('.a { padding: 13px 16px; }')).toEqual(['px-4', 'py-3.25'])
  })

  it('maps @supports to a supports variant', async () => {
    const classes = await classesFor('@supports (display: grid) { .a { display: flex; } }')
    expect(classes).toEqual(['supports-[display:grid]:flex'])
  })

  it('keeps rules under unsupported media queries as complementary', async () => {
    const { nodes } = await c.convert('@media (min-resolution: 2dppx) { .a { display: flex; } }')
    expect(nodes[0].tailwindClasses).toEqual([])
    expect(nodes[0].complementary).toContain('display: flex')
  })

  it('keeps rules under unsupported at-rules as complementary', async () => {
    const { nodes } = await c.convert('@layer components { .a { display: flex; } }')
    expect(nodes[0].tailwindClasses).toEqual([])
    expect(nodes[0].complementary).toContain('display: flex')
  })

  it('ignores comments inside a rule', async () => {
    expect(await classesFor('.a { /* note */ display: block; }')).toEqual(['block'])
  })

  it('falls back to an arbitrary property for un-rooted color properties', async () => {
    const classes = await classesFor('.a { flood-color: #fb2c36; }')
    expect(classes).toEqual(['[flood-color:#fb2c36]'])
  })

  it('keeps off-scale values complementary when arbitrary is disabled', async () => {
    const c2 = new CssToTailwind({ arbitrary: false })
    const { nodes } = await c2.convert('.a { padding: 13.7px; }')
    expect(nodes[0].tailwindClasses).toEqual([])
    expect(nodes[0].complementary).toContain('padding: 13.7px')
  })

  it('keeps negative sign outermost with variants', async () => {
    const classes = await classesFor('@media (min-width: 48rem) { .a { margin-top: -1rem; } }')
    expect(classes).toEqual(['md:-mt-4'])
  })

  it('preserves !important in complementary output', async () => {
    const c2 = new CssToTailwind({ arbitrary: false })
    const { nodes } = await c2.convert('.a { animation-name: spin !important; }')
    expect(nodes[0].complementary).toContain('!important')
  })
})
