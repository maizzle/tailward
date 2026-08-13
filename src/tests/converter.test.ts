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

  it('caps oversized spacing to arbitrary by default (scale ceiling 96)', async () => {
    expect(await classesFor('.a { width: 600px; }')).toEqual(['w-[600px]']) // 150 > 96
    expect(await classesFor('.a { width: 168px; }')).toEqual(['w-42']) // 42 <= 96, on scale
    expect(await classesFor('.a { padding: 3.25rem; }')).toEqual(['p-13']) // in-range dynamic step
  })

  it('maxSpacingSteps: Infinity reverses any multiple', async () => {
    const uncapped = new CssToTailwind({ remInPx: 16, maxSpacingSteps: Infinity })
    await uncapped.convert('.x{}')
    const { nodes } = await uncapped.convert('.a { width: 600px; }')
    expect(nodes[0].tailwindClasses).toEqual(['w-150'])
  })

  it('maxSpacingSteps can be stricter', async () => {
    const strict = new CssToTailwind({ remInPx: 16, maxSpacingSteps: 24 })
    await strict.convert('.x{}')
    const { nodes } = await strict.convert('.a { width: 168px; }')
    expect(nodes[0].tailwindClasses).toEqual(['w-[168px]']) // 42 > 24
  })

  it('collapses a font-size + its default line-height into the bare size token', async () => {
    // 28px is text-xl's default line-height (text-xl already sets it) -> bare text-xl
    expect(await classesFor('.a { font-size: 20px; line-height: 28px; }')).toEqual(['text-xl'])
    expect(await classesFor('.a { font-size: 14px; line-height: 20px; }')).toEqual(['text-sm'])
  })

  it('fuses a divergent line-height into the /leading shorthand', async () => {
    expect(await classesFor('.a { font-size: 20px; line-height: 20px; }')).toEqual(['text-xl/5'])
    expect(await classesFor('.a { font-size: 14px; line-height: 16px; }')).toEqual(['text-sm/4'])
  })

  it('maps a zero-alpha color and the default radius to bare tokens', async () => {
    expect(await classesFor('.a { background-color: rgba(0,0,0,0); }')).toEqual(['bg-transparent'])
    expect(await classesFor('.a { border-radius: 0.25rem; }')).toEqual(['rounded'])
  })

  it('does not fuse a text color with a line-height', async () => {
    expect(await classesFor('.a { color: #030712; font-size: 20px; line-height: 28px; }')).toEqual([
      'text-gray-950', 'text-xl',
    ])
  })

  it('recombines equal opposite longhands into axis/corner utilities', async () => {
    expect(await classesFor('.a { padding-left: 24px; padding-right: 24px; }')).toEqual(['px-6'])
    expect(await classesFor('.a { border-top-left-radius: 6px; border-top-right-radius: 6px; }')).toEqual([
      'rounded-t-md',
    ])
    // Bare default-radius corners combine too.
    expect(await classesFor('.a { border-top-left-radius: 0.25rem; border-top-right-radius: 0.25rem; }')).toEqual([
      'rounded-t',
    ])
    // Different values don't merge.
    expect(await classesFor('.a { padding: 0 24px; }')).toEqual(['px-6', 'py-0'])
  })

  it('maps @supports to a supports variant', async () => {
    const classes = await classesFor('@supports (display: grid) { .a { display: flex; } }')
    expect(classes).toEqual(['supports-[display:grid]:flex'])
  })

  it('represents an unnamed media query faithfully as an arbitrary variant', async () => {
    const classes = await classesFor('@media (min-resolution: 2dppx) { .a { display: flex; } }')
    expect(classes).toEqual(['[@media(min-resolution:2dppx)]:flex'])
  })

  it('maps a max-width query to a faithful arbitrary variant (not max-[N])', async () => {
    // Stock theme has no max-width named variants; 599px must stay width<=599.
    const classes = await classesFor('@media (max-width: 599px) { .a { display: flex; } }')
    expect(classes).toEqual(['[@media(max-width:599px)]:flex'])
  })

  it('keeps rules under unsupported at-rules as complementary', async () => {
    const { nodes } = await c.convert('@layer components { .a { display: flex; } }')
    expect(nodes[0].tailwindClasses).toEqual([])
    expect(nodes[0].complementary).toContain('display: flex')
  })

  it('keeps rules under an unmappable media feature as complementary', async () => {
    const { nodes } = await c.convert('@media tv { .a { display: flex; } }')
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

  describe('transform / filter / gradient decomposition', () => {
    it('decomposes transform functions into per-axis utilities', async () => {
      expect(await classesFor('.a { transform: translateX(10px); }')).toEqual(['translate-x-2.5'])
      expect(await classesFor('.a { transform: translate(10px, 20px); }')).toEqual(['translate-x-2.5', 'translate-y-5'])
      expect(await classesFor('.a { transform: scale(1.5); }')).toEqual(['scale-150'])
      expect(await classesFor('.a { transform: rotate(-45deg); }')).toEqual(['-rotate-45'])
      expect(await classesFor('.a { transform: translateX(10px) rotate(45deg); }')).toEqual(['translate-x-2.5', 'rotate-45'])
    })

    it('keeps an unmappable transform as a faithful arbitrary property', async () => {
      expect(await classesFor('.a { transform: translateX(13.7px); }')).toEqual(['[transform:translateX(13.7px)]'])
    })

    it('maps the named transform-none utility', async () => {
      expect(await classesFor('.a { transform: none; }')).toEqual(['transform-none'])
    })

    it('decomposes filter functions, including rem-based blur', async () => {
      expect(await classesFor('.a { filter: blur(4px); }')).toEqual(['blur-xs'])
      expect(await classesFor('.a { filter: blur(0.25rem); }')).toEqual(['blur-xs'])
      expect(await classesFor('.a { filter: brightness(1.5); }')).toEqual(['brightness-150'])
      expect(await classesFor('.a { filter: grayscale(100%); }')).toEqual(['grayscale'])
      expect(await classesFor('.a { filter: blur(4px) brightness(1.5); }')).toEqual(['blur-xs', 'brightness-150'])
    })

    it('keeps an off-scale filter as a faithful arbitrary property', async () => {
      expect(await classesFor('.a { filter: blur(3px); }')).toEqual(['[filter:blur(3px)]'])
    })

    it('decomposes linear gradients into bg-linear + color stops', async () => {
      expect(await classesFor('.a { background-image: linear-gradient(to right, #fb2c36, #155dfc); }')).toEqual([
        'bg-linear-to-r', 'from-red-500', 'to-blue-600',
      ])
      expect(await classesFor('.a { background: linear-gradient(#000, #fff); }')).toEqual([
        'bg-linear-to-b', 'from-black', 'to-white',
      ])
    })

    it('keeps a non-linear gradient as a faithful arbitrary property', async () => {
      expect(await classesFor('.a { background-image: radial-gradient(#000, #fff); }')).toEqual([
        '[background-image:radial-gradient(#000,_#fff)]',
      ])
    })

    it('leaves a gradient as complementary when arbitrary is disabled', async () => {
      const c2 = new CssToTailwind({ arbitrary: false })
      const { nodes } = await c2.convert('.a { background-image: radial-gradient(#000, #fff); }')
      expect(nodes[0].tailwindClasses).toEqual([])
      expect(nodes[0].complementary).toContain('radial-gradient')
    })
  })

  describe('container queries', () => {
    it('maps a min-width container query to a named token variant', async () => {
      expect(await classesFor('@container (min-width: 24rem) { .a { display: flex; } }')).toEqual(['@sm:flex'])
      expect(await classesFor('@container (min-width: 28rem) { .a { display: block; } }')).toEqual(['@md:block'])
    })

    it('falls back to @min-[N] for an off-token min-width', async () => {
      expect(await classesFor('@container (min-width: 400px) { .a { display: flex; } }')).toEqual(['@min-[400px]:flex'])
    })

    it('carries a named container through', async () => {
      expect(await classesFor('@container sidebar (min-width: 400px) { .a { display: flex; } }')).toEqual([
        '@min-[400px]/sidebar:flex',
      ])
    })

    it('keeps a max-width container query faithful (not @max-[N])', async () => {
      expect(await classesFor('@container (max-width: 400px) { .a { display: flex; } }')).toEqual([
        '[@container(max-width:400px)]:flex',
      ])
    })

    it('keeps a named non-min container query as complementary', async () => {
      const { nodes } = await c.convert('@container sidebar (max-width: 400px) { .a { display: flex; } }')
      expect(nodes[0].tailwindClasses).toEqual([])
      expect(nodes[0].complementary).toContain('display: flex')
    })
  })

  describe('source positions', () => {
    it('omits positions by default', async () => {
      const { nodes } = await c.convert('.a { display: flex; }')
      expect(nodes[0].position).toBeUndefined()
    })

    it('reports a rule span that slices back to the source', async () => {
      const css = '.a { display: flex }\n\n@media (min-width: 48rem) {\n  .b { display: block }\n}'
      const positioned = new CssToTailwind({ positions: true })
      await positioned.convert('.x{}')
      const { nodes } = await positioned.convert(css)
      expect(nodes[0].position).toEqual({ start: 0, end: 20, line: 1, column: 1 })
      expect(css.slice(nodes[0].position!.start, nodes[0].position!.end)).toBe('.a { display: flex }')
      // Nested rule points at its selector, not the enclosing at-rule.
      expect(nodes[1].position).toMatchObject({ line: 4, column: 3 })
      expect(css.slice(nodes[1].position!.start, nodes[1].position!.end)).toBe('.b { display: block }')
    })

    it('keeps offsets accurate across a length-preserving comment strip', async () => {
      const css = '/* leading comment */\n.z { color: #fb2c36 }'
      const positioned = new CssToTailwind({ positions: true })
      await positioned.convert('.x{}')
      const { nodes } = await positioned.convert(css)
      expect(nodes[0].position!.line).toBe(2)
      expect(css.slice(nodes[0].position!.start, nodes[0].position!.end)).toBe('.z { color: #fb2c36 }')
    })
  })

  describe('important option', () => {
    it('drops !important by default', async () => {
      expect(await classesFor('.a { color: #fb2c36 !important; }')).toEqual(['text-red-500'])
    })

    it('emits the v4 trailing bang when important is on', async () => {
      const imp = new CssToTailwind({ important: true })
      await imp.convert('.x{}')
      const { nodes } = await imp.convert('.a { color: #fb2c36 !important; padding: 8px !important; }')
      expect(nodes[0].tailwindClasses).toEqual(['p-2!', 'text-red-500!'])
    })

    it('bangs only the important declarations in a mixed rule', async () => {
      const imp = new CssToTailwind({ important: true })
      await imp.convert('.x{}')
      const { nodes } = await imp.convert('.a { display: flex; color: #fb2c36 !important; }')
      expect(nodes[0].tailwindClasses).toEqual(['flex', 'text-red-500!'])
    })

    it('keeps the bang outside variants', async () => {
      const imp = new CssToTailwind({ important: true })
      await imp.convert('.x{}')
      const { nodes } = await imp.convert('@media (min-width: 48rem) { .a:hover { margin-top: -1rem !important; } }')
      expect(nodes[0].tailwindClasses).toEqual(['md:hover:-mt-4!'])
    })

    it('bangs a fused text-size/leading utility', async () => {
      const imp = new CssToTailwind({ important: true })
      await imp.convert('.x{}')
      const { nodes } = await imp.convert('.a { font-size: 20px !important; line-height: 20px !important; }')
      expect(nodes[0].tailwindClasses).toEqual(['text-xl/5!'])
    })

    it('combines equal important longhands, but not mixed importance', async () => {
      const imp = new CssToTailwind({ important: true })
      await imp.convert('.x{}')
      expect((await imp.convert('.a { padding-left: 24px !important; padding-right: 24px !important; }')).nodes[0].tailwindClasses).toEqual([
        'px-6!',
      ])
      const mixed = await imp.convert('.a { padding-left: 24px !important; padding-right: 24px; }')
      expect(mixed.nodes[0].tailwindClasses).toEqual(['pr-6', 'pl-6!'])
    })
  })
})
