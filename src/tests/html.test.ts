import { describe, it, expect } from 'vitest'
import { convertHtml } from '../html.ts'

describe('convertHtml — inline style attributes', () => {
  it('rewrites inline styles into classes and drops the style attribute', async () => {
    const { html } = await convertHtml('<div style="display:flex; padding:1rem">x</div>')
    expect(html).toBe('<div class="flex p-4">x</div>')
  })

  it('merges converted classes with the existing class attribute', async () => {
    const { html } = await convertHtml('<div class="foo" style="margin:8px">x</div>')
    expect(html).toBe('<div class="foo m-2">x</div>')
  })

  it('keeps unconvertible declarations in the style attribute', async () => {
    const { html } = await convertHtml('<div style="display:flex; animation-timeline:view()">x</div>', {
      arbitrary: false,
    })
    expect(html).toBe('<div style="animation-timeline: view()" class="flex">x</div>')
  })

  it('keeps the original style attribute when keepStyleAttr is set', async () => {
    const { html } = await convertHtml('<div style="display:flex">x</div>', { keepStyleAttr: true })
    expect(html).toBe('<div style="display:flex" class="flex">x</div>')
  })

  it('leaves inline styles untouched when inline is false', async () => {
    const { html } = await convertHtml('<div style="display:flex">x</div>', { inline: false })
    expect(html).toBe('<div style="display:flex">x</div>')
  })
})

describe('convertHtml — <style> rules', () => {
  it('attaches a plain rule to matching elements and removes the emptied block', async () => {
    const { html } = await convertHtml('<style>.btn{display:block;padding:16px}</style><a class="btn">x</a>')
    expect(html).toBe('<a class="btn block p-4">x</a>')
  })

  it('bakes a pseudo-class into a variant', async () => {
    const { html } = await convertHtml('<style>.btn:hover{color:#fb2c36}</style><a class="btn">x</a>')
    expect(html).toBe('<a class="btn hover:text-red-500">x</a>')
  })

  it('bakes a media query into a responsive variant', async () => {
    const { html } = await convertHtml(
      '<style>@media (min-width:48rem){.btn{display:flex}}</style><a class="btn">x</a>',
    )
    expect(html).toBe('<a class="btn md:flex">x</a>')
  })

  it('bakes a pseudo-element into a variant', async () => {
    const { html } = await convertHtml('<style>.btn::before{color:#fb2c36}</style><a class="btn">x</a>')
    expect(html).toBe('<a class="btn before:text-red-500">x</a>')
  })

  it('matches descendant selectors against the DOM', async () => {
    const { html } = await convertHtml(
      '<style>.card .btn{display:block}</style><div class="card"><a class="btn">x</a></div>',
    )
    expect(html).toBe('<div class="card"><a class="btn block">x</a></div>')
  })

  it('keeps rules that match no element as a residual <style>', async () => {
    const { html } = await convertHtml('<style>.ghost{display:block}</style><a class="btn">x</a>')
    expect(html).toBe('<style>.ghost { display: block }</style><a class="btn">x</a>')
  })

  it('preserves @keyframes and @font-face blocks verbatim', async () => {
    const css = '@keyframes spin{from{opacity:0}to{opacity:1}}'
    const { html } = await convertHtml(`<style>${css}</style>`)
    expect(html).toBe(`<style>${css}</style>`)
  })

  it('does not split a block on braces inside a quoted value', async () => {
    const { html } = await convertHtml('<style>.ghost{font-family:"A}B"}</style><a class="btn">x</a>')
    expect(html).toBe('<style>.ghost { font-family: "A}B" }</style><a class="btn">x</a>')
  })

  it('tolerates an unbalanced final brace', async () => {
    const { html } = await convertHtml('<style>.ghost{color:red</style><a class="btn">x</a>')
    expect(html).toContain('<style>.ghost { color: red }</style>')
  })

  it('keeps selectorless at-rule declarations as residual', async () => {
    const { html } = await convertHtml('<style>@media (min-width:48rem){color:red}</style>')
    expect(html).toContain('@media (min-width:48rem) { color: red; }')
  })

  it('ignores braces inside a top-level quoted string and keeps @import verbatim', async () => {
    const { html } = await convertHtml(
      '<style>@import url("a{b}");\n.btn{display:block}</style><a class="btn">x</a>',
    )
    expect(html).toContain('class="btn block"')
    expect(html).toContain('@import url("a{b}");')
  })

  it('keeps rules with an unsupported pseudo (invalid to css-select) as residual', async () => {
    const { html } = await convertHtml('<style>.btn:foobar{display:block}</style><a class="btn">x</a>')
    expect(html).toBe('<style>.btn:foobar { display: block }</style><a class="btn">x</a>')
  })
})

describe('convertHtml — styleRules modes', () => {
  it('residual: leaves <style> untouched, still inlines attributes', async () => {
    const { html } = await convertHtml(
      '<style>.btn{display:block}</style><a class="btn" style="color:#fb2c36">x</a>',
      { styleRules: 'residual' },
    )
    expect(html).toBe('<style>.btn{display:block}</style><a class="btn text-red-500">x</a>')
  })

  it('drop: discards rules that cannot be attached instead of keeping residual', async () => {
    const { html } = await convertHtml('<style>.ghost{display:block}</style><a class="btn">x</a>', {
      styleRules: 'drop',
    })
    expect(html).toBe('<a class="btn">x</a>')
  })
})

describe('convertHtml — fidelity', () => {
  it('round-trips entities, comments, and MSO conditionals byte-for-byte', async () => {
    const src =
      '<!--[if mso]><table><tr><td>x</td></tr></table><![endif]-->' +
      '<p style="font-weight:700">Hi &amp; bye &copy; — café</p>'
    const { html } = await convertHtml(src)
    expect(html).toBe(
      '<!--[if mso]><table><tr><td>x</td></tr></table><![endif]-->' +
        '<p class="font-bold">Hi &amp; bye &copy; — café</p>',
    )
  })

  it('reports warnings from the underlying conversion', async () => {
    const { warnings } = await convertHtml('<div style="animation-timeline:view()">x</div>', {
      arbitrary: false,
    })
    expect(warnings.some((w) => w.type === 'unconvertible')).toBe(true)
  })
})
