<div align="center">
  <h1>Tailward</h1>
  <p><em>towards tailwind</em></p>
  <div>

  [![Version][npm-version-shield]][npm]
  [![Build][github-ci-shield]][github-ci]
  [![Downloads][npm-stats-shield]][npm-stats]
  [![License][license-shield]][license]

  </div>
</div>

## About

Tailward converts regular CSS to Tailwind CSS 4 utility classes.

Give it a declaration, a rule, or a whole stylesheet and you get back the utility classes that produce the same result - ready to drop straight into your markup.

It's handy when you're moving an existing project over to Tailwind, or turning inlined HTML back into clean, class-based templates, without redoing all that styling by hand.

Runs on Node 18+ or a modern edge runtime.

## Contents

- [Installation](#installation)
- [Usage](#usage)
- [API](#api)
- [CLI](#cli)
- [What it converts](#what-it-converts)
- [De-inlining HTML](#de-inlining-html)
- [Themes](#themes)

## Installation

```sh
npm install tailward
```

## Usage

Convert a stylesheet and read the classes back, grouped per selector:

```ts
import { CssToTailwind } from 'tailward'

const converter = new CssToTailwind()

const { nodes } = await converter.convert(`
  .button {
    display: inline-flex;
    padding: 0.5rem 1rem;
    background-color: #fb2c36;
    border-radius: 0.375rem;
    font-weight: 600;
  }
  .button:hover {
    background-color: #e7000b;
  }
  @media (min-width: 48rem) {
    .button { padding-left: 2rem; }
  }
`)

for (const node of nodes) {
  console.log(node.selector, '→', node.tailwindClasses.join(' '))
}
// .button → inline-flex rounded-md bg-red-500 px-4 py-2 font-semibold
// .button → hover:bg-red-600
// .button → md:pl-8
```

The index builds on the first `convert()` call and is cached after that, so construct the converter once and reuse it. For a quick one-off, there's `convertCss`:

```ts
import { convertCss } from 'tailward'

const { nodes } = await convertCss('.a { display: block }')
```

## API

### `new CssToTailwind(options?)`

### `converter.convert(css): Promise<ConvertResult>`

```ts
interface ConvertResult {
  nodes: {
    selector: string          // the original selector
    tailwindClasses: string[] // in Tailwind's class order
    complementary: string     // declarations that couldn't convert, as CSS
  }[]
  warnings: {
    type: 'approximate-color' | 'unconvertible'
    selector: string          // the rule it came from
    declaration: string       // "color: #a1b2c3"
    message: string           // human-readable explanation
  }[]
  summary: {
    converted: number         // declarations that produced utilities
    unconvertible: number     // declarations left as complementary CSS
    arbitrary: number         // emitted utilities using an arbitrary value or property
    coverage: number          // converted / (converted + unconvertible), 0 to 1
  }
}
```

With `{ positions: true }`, each node also carries a `position` of `{ start, end, line, column }`, mapping the rule back to the input for editor "convert selection" integrations. It's off by default.

`warnings` surfaces what the conversion glossed over: colors matched to a *near* palette token rather than an exact one, and declarations left unconverted.

```ts
const { warnings } = await convertCss('.a { color: #a1b2c3 }', { colorThreshold: 0.2 })
// [{ type: 'approximate-color', selector: '.a', declaration: 'color: #a1b2c3',
//    message: 'approximated #a1b2c3 to text-mist-400 (ΔE 0.039)' }]
```

### `convertCss(css, options?): Promise<ConvertResult>`

A one-shot wrapper around `new CssToTailwind(options).convert(css)`.

### `convertHtml(html, options?): Promise<{ html, warnings }>`

De-inlines a full HTML document. See [De-inlining HTML](#de-inlining-html) above. Also available from the `tailward/html` subpath. `options` extends the converter options with `styleAttributes`, `styleRules`, and `keepStyleAttributes`.

### `toApply(result)` and `toClassMap(result)`

Two ways to format a `ConvertResult`. `toApply` renders copy-pasteable `@apply` rules (one per selector, with unconvertible declarations kept as raw CSS); `toClassMap` returns `{ selector: 'class list' }`.

```ts
import { convertCss, toApply, toClassMap } from 'tailward'

const result = await convertCss('.a { display: flex; padding: 1rem }')
toApply(result)    // ".a { @apply flex p-4; }"
toClassMap(result) // { '.a': 'flex p-4' }
```

### Options

Every entry point takes the same options object - the `CssToTailwind` constructor, `convertCss`, and `convertHtml` (which adds a [few of its own](#de-inlining-html) on top). They're all optional.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `theme` | `string` | - | Custom `@theme` token overrides (engine-free, edge-safe). |
| `css` | `string` | - | Full CSS resolved by the Tailwind engine (Node only). |
| `base` | `string` | `process.cwd()` | Directory for resolving `@import` / `@plugin` in `css`. |
| `remInPx` | `number` | `16` | Pixel value of `1rem` for normalizing `px` inputs. |
| `arbitrary` | `boolean` | `true` | Emit arbitrary values when nothing matches; otherwise keep as raw CSS. |
| `colorThreshold` | `number` | `0.02` | Max OKLab distance to match a palette color. `0` means exact only. |
| `canonicalize` | `boolean` | `true` | Prefer named functional utilities for bare numbers (`z-60` over `z-[60]`). |
| `important` | `boolean` | `false` | Preserve `!important` as the v4 trailing bang (`text-red-500!`, `sm:text-red-500!`); otherwise dropped. |
| `positions` | `boolean` | `false` | Attach a `position` (`{ start, end, line, column }`) to each node, mapping it back to the source. |
| `maxSpacingSteps` | `number` | `96` | Largest spacing multiplier reversed to a scale utility; larger lengths stay arbitrary (`600px` becomes `w-[600px]`, not `w-150`). Use `Infinity` to reverse any multiple. |

A few of them in practice, on `convertCss`:

```ts
import { convertCss } from 'tailward'

// colorThreshold: match only exact palette colors, near-misses stay arbitrary.
await convertCss('.a { color: #f9323d }')                        // → text-red-500
await convertCss('.a { color: #f9323d }', { colorThreshold: 0 }) // → text-[#f9323d]

// maxSpacingSteps: reverse any spacing multiple, not just the conventional range.
await convertCss('.a { width: 600px }', { maxSpacingSteps: Infinity }) // → w-150

// arbitrary: keep unmatched declarations as raw CSS instead of an arbitrary value.
await convertCss('.a { width: 33.7% }', { arbitrary: false }) // → kept in node.complementary, no class
```

The same options flow through `convertHtml`, since it runs the converter under the hood:

```ts
import { convertHtml } from 'tailward'

// colorThreshold: 0 keeps the color arbitrary; remInPx: 8 rescales the padding.
const { html } = await convertHtml(
  '<a style="color: #f9323d; padding: 16px">Go</a>',
  { colorThreshold: 0, remInPx: 8 },
)
// <a class="p-8 text-[#f9323d]">Go</a>
```

### Regenerating

The pregenerated index is committed and pinned to a `tailwindcss` version. After bumping `tailwindcss`:

```sh
npm run generate
```

`stock-theme.test.ts` asserts the pregenerated output matches the live engine across every indexed declaration, so CI fails if the data goes stale.


## CLI

Installing the package gives you a `tailward` binary. It reads a file or stdin and prints `@apply` blocks. Point it at an `.html` file (or pass `--html`) to de-inline instead.

```sh
tailward styles.css                 # @apply blocks on stdout
cat styles.css | tailward --json    # raw ConvertResult as JSON
tailward email.html --important --out out.html
tailward styles.css --theme brand.css --summary
tailward styles.css --watch         # re-run on change
```

| Flag | Description |
| --- | --- |
| `--html` | De-inline an HTML document (auto-enabled for `.html`/`.htm`). |
| `--theme <file>` | Convert against a custom `@theme` file (engine-free). |
| `--css <file>` | Convert against full CSS via the Tailwind engine. |
| `--rem <n>` | Pixel value of `1rem` (default 16). |
| `--important` | Preserve `!important` as the v4 trailing bang. |
| `--out <file>` | Write output to a file instead of stdout. |
| `--json` | Output the raw conversion result as JSON (CSS mode). |
| `--summary` | Print a conversion summary to stderr. |
| `--watch` | Re-run when the input file changes. |

## What it converts

- **Full stylesheets.** Selectors, `@media` to responsive variants (`md:`), pseudo-classes and elements to variants (`hover:`, `before:`), `@supports` to `supports-[…]:`, and `@container` to container-query variants (`@sm:`, `@min-[400px]:`).
- **Colors.** Nearest palette match in OKLab (`#fb2c36` becomes `text-red-500`), falling back to an arbitrary value past a threshold.
- **Spacing.** Any Tailwind 0.25-step multiplier (`13px` becomes `p-3.25`, `0.875rem` becomes `p-3.5`), plus box-shorthand decomposition (`padding: 0 24px` becomes `px-6 py-0`).
- **Named tokens.** `border-radius: 0.5rem` becomes `rounded-lg`, `font-weight: 700` becomes `font-bold`, `font-size: 20px` becomes `text-xl`.
- **Composite properties.** `transform`, `filter`, and linear gradients decompose into per-function utilities: `transform: translateX(10px) rotate(45deg)` becomes `translate-x-2.5 rotate-45`, `filter: blur(4px)` becomes `blur-xs`, `linear-gradient(to right, #fb2c36, #155dfc)` becomes `bg-linear-to-r from-red-500 to-blue-600`.
- **Everything else.** Emitted as an arbitrary value (`p-[13.7px]`, `bg-[#123456]`) or arbitrary property (`[mask-type:luminance]`). Set `arbitrary: false` to keep unmatched declarations as raw CSS instead.

Every class it emits is checked to reproduce the exact input declaration - against the live engine on the `css` path, or against the pregenerated data (verified the same way) on the engine-free paths.

## De-inlining HTML

`convertHtml` takes a whole HTML document and rewrites it, turning both inline `style=""` attributes and `<style>` rules into utility classes. It's built for de-inlining email HTML or migrating a static page.

```ts
import { convertHtml } from 'tailward' // or 'tailward/html'

const { html, warnings } = await convertHtml(input)
```

Given this `input`:

```html
<style>
  .card { border-radius: 8px; background-color: #fff }
  .card:hover { color: #fb2c36 }
  @media (min-width: 48rem) { .card { padding: 24px } }
</style>

<div class="card" style="padding: 16px">Hello</div>
```

...you get `html` back like this:

```html
<div class="card rounded-lg bg-white hover:text-red-500 md:p-6 p-4">Hello</div>
```

The `style=""` becomes `p-4`, the `.card` rule becomes `rounded-lg bg-white`, `:hover` and `@media` bake into the `hover:` and `md:` variants, and the `<style>` block is dropped once everything in it has converted.

Here's what it does with each part:

- Inline `style=""` becomes classes merged into `class`, and the attribute is dropped. Anything that can't convert stays behind in `style` (or keep the original with `keepStyleAttributes`).
- `<style>` rules convert with their context baked into the variant (`@media` becomes `sm:`, `:hover` becomes `hover:`, `::before` becomes `before:`), then attach to every element the selector matches.
- `@keyframes`, `@font-face`, `@import`, and any rule that can't be fully converted or matched are left in a trimmed `<style>` block.
- Entities, comments, and Outlook (MSO) conditionals round-trip untouched.

It accepts every [converter option](#options), plus these:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `styleAttributes` | `boolean` | `true` | Convert inline `style=""` attributes into classes. |
| `styleRules` | `'variants' \| 'residual' \| 'drop'` | `'variants'` | `variants`: convert `<style>` rules to classes on matching elements, keep the rest as residual CSS. `residual`: leave every `<style>` untouched. `drop`: convert what maps, discard the rest. |
| `keepStyleAttributes` | `boolean` | `false` | Keep the original `style=""` alongside the emitted classes. |

`convertHtml` is also exported from the `tailward/html` subpath, so bundlers can tree-shake the HTML parser out of the core entry. Its parsing deps are pure-JS and edge-safe either way.

## Themes

There are three ways to tell Tailward which theme to convert against:

| You pass | Runs on | Uses the engine? | Use it for |
| --- | --- | --- | --- |
| _(nothing)_ | Node **and edge** | no | the default Tailwind theme |
| `{ theme }` | Node **and edge** | no | a custom `@theme` (token overrides) |
| `{ css }` | Node only | yes | `@plugin`, custom `@utility`, `@import` |

### Default (stock theme)

```ts
new CssToTailwind()
```

Uses a pregenerated index for the stock Tailwind theme. Fully edge-compatible.

### Custom `@theme`

Override design tokens (colors, spacing, radius, font sizes, and so on) and convert against them without the Tailwind engine, so it works per-request on the edge:

```ts
const converter = new CssToTailwind({
  theme: `@theme {
    --color-brand: oklch(55% 0.2 270);
    --spacing: 0.2rem;
    --radius-lg: 1rem;
  }`,
})

await converter.convert('.a { background-color: oklch(55% 0.2 270) }')
// → bg-brand
await converter.convert('.a { padding: 0.4rem }')   // 0.4 / 0.2
// → p-2
```

Only token overrides are supported here. The output is byte-identical to running the real engine with the same `@theme`.

### Full engine (`css`)

For themes that need the actual compiler (`@plugin`, custom `@utility`, `@import`), pass raw CSS. This dynamically imports `tailwindcss` and reads from disk, so it runs in Node only:

```ts
new CssToTailwind({
  css: '@import "tailwindcss";\n@plugin "./my-plugin.js";',
  base: process.cwd(), // resolves @import / @plugin paths
})
```

[npm]: https://www.npmjs.com/package/tailward
[npm-stats]: https://npm-stat.com/charts.html?package=tailward
[github-ci]: https://github.com/maizzle/tailward/actions
[license]: https://opensource.org/licenses/MIT
[npm-version-shield]: https://img.shields.io/npm/v/tailward.svg
[github-ci-shield]: https://github.com/maizzle/tailward/actions/workflows/nodejs.yml/badge.svg
[npm-stats-shield]: https://img.shields.io/npm/dt/tailward.svg?color=4f46e5
[license-shield]: https://img.shields.io/npm/l/tailward.svg?color=4f46e5
