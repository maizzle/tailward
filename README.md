# tailward

Convert regular CSS to [Tailwind CSS v4](https://tailwindcss.com) utility classes.

- **Accurate** — inverts Tailwind's own design system instead of hand-maintained maps. Every mapping is verified against the real engine at build time.
- **Fast** — ~11ms cold start, ~0.004ms per conversion once warm.
- **Edge-ready** — the default and custom-`theme` paths use a pregenerated index with **no Tailwind engine and no `node:fs`**, so they run in Cloudflare Workers, Vercel Edge, Deno, etc.
- **v4-native** — CSS-first `@theme`, the OKLCH palette, the dynamic spacing scale, logical properties, and arbitrary values.

> Requires Node 18+ / a modern edge runtime. ESM only.

## Install

```sh
npm install tailward
```

`tailwindcss` is a peer dependency but is **only** needed if you use the `css` (engine) option — the stock and `theme` paths never import it.

## Usage

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

Construct the converter once and reuse it — the index is built on the first
`convert()` call and cached. For a quick one-off there's also a helper:

```ts
import { convertCss } from 'tailward'

const { nodes } = await convertCss('.a { display: block }')
```

## HTML — de-inline to classes

`convertHtml` rewrites a whole HTML document: inline `style=""` attributes and
`<style>` rules become Tailwind utility classes. Handy for de-inlining email
HTML or migrating a static page.

```ts
import { convertHtml } from 'tailward' // or 'tailward/html' to keep bundles lean

const { html, warnings } = await convertHtml(`
  <style>
    .btn:hover { color: #fb2c36 }
    @media (min-width: 48rem) { .btn { display: flex } }
  </style>
  <a class="btn" style="margin: 8px; font-weight: 700">Go</a>
`)
// <a class="btn hover:text-red-500 md:flex m-2 font-bold">Go</a>
```

- Inline `style=""` → classes merged into `class`; the attribute is dropped
  (unconvertible declarations stay behind in `style`, or keep it all with
  `keepStyleAttr`).
- `<style>` rules convert with their context baked into variants
  (`@media` → `sm:`, `:hover` → `hover:`, `::before` → `before:`) and attach to
  every element matching the rule's selector.
- `@keyframes`, `@font-face`, `@import`, and any rule that can't be fully
  converted or matched are preserved in a trimmed residual `<style>`.
- Entities, comments, and Outlook (MSO) conditionals round-trip untouched.

It accepts every [converter option](#options) plus:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `inline` | `boolean` | `true` | Rewrite inline `style=""` attributes. |
| `styleRules` | `'variants' \| 'residual' \| 'drop'` | `'variants'` | `variants`: convert `<style>` rules to classes on matching elements, keeping the rest as residual CSS. `residual`: leave every `<style>` untouched. `drop`: convert what maps, discard the rest. |
| `keepStyleAttr` | `boolean` | `false` | Keep the original `style=""` alongside the emitted classes. |

`convertHtml` is also exported from the `tailward/html` subpath so bundlers can
tree-shake the HTML parser out of the core entry — though its parsing deps are
pure-JS and edge-safe either way.

## CLI

Installing the package adds a `tailward` binary. It reads a file (or stdin) and
prints `@apply` blocks; pass an `.html` file (or `--html`) to de-inline instead.

```sh
tailward styles.css                 # -> @apply blocks on stdout
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

## What it handles

- **Full stylesheets** — selectors, `@media` → responsive variants (`md:`), pseudo-classes/elements → variants (`hover:`, `before:`), `@supports` → `supports-[…]:`.
- **Colors** — nearest palette match in OKLab (`#fb2c36` → `text-red-500`), falling back to arbitrary values past a threshold.
- **Spacing** — any Tailwind 0.25-step multiplier (`13px` → `p-3.25`, `0.875rem` → `p-3.5`), plus box-shorthand decomposition (`padding: 0 24px` → `px-6 py-0`).
- **Named tokens** — `border-radius: 0.5rem` → `rounded-lg`, `font-weight: 700` → `font-bold`, `font-size: 20px` → `text-xl`.
- **Composite properties** — `transform`, `filter`, and linear gradients decompose into per-function utilities: `transform: translateX(10px) rotate(45deg)` → `translate-x-2.5 rotate-45`, `filter: blur(4px)` → `blur-xs`, `linear-gradient(to right, #fb2c36, #155dfc)` → `bg-linear-to-r from-red-500 to-blue-600`.
- **Anything else** — emitted as an arbitrary value (`p-[13.7px]`, `bg-[#123456]`) or arbitrary property (`[mask-type:luminance]`); set `arbitrary: false` to keep unmatched declarations as raw CSS instead.

Every produced class is verified to reproduce exactly the input declaration —
either against the live engine (`css` path) or, on the engine-free paths,
against the pregenerated data that was itself verified this way.

## Themes — three paths

| You pass | Runs on | Uses the engine? | Use for |
| --- | --- | --- | --- |
| _(nothing)_ | Node **+ edge** | no | the default Tailwind theme |
| `{ theme }` | Node **+ edge** | no | a custom `@theme` (token overrides) |
| `{ css }` | Node only | yes | `@plugin`, custom `@utility`, `@import` |

### Default (stock theme)

```ts
new CssToTailwind()
```

Uses a pregenerated index for the stock Tailwind theme. Fully edge-compatible.

### Custom `@theme` — engine-free, edge-safe

Override design tokens (colors, spacing, radius, font sizes, …) and convert
against them **without the Tailwind engine** — so it works per-request on edge:

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

Only token overrides are supported here. Output is byte-identical to running
the real engine with the same `@theme`.

### Full engine (`css`) — Node only

For themes that need the actual compiler (`@plugin`, custom `@utility`,
`@import`), pass raw CSS. This dynamically imports `tailwindcss` and reads from
disk, so it runs in Node only:

```ts
new CssToTailwind({
  css: '@import "tailwindcss";\n@plugin "./my-plugin.js";',
  base: process.cwd(), // resolves @import / @plugin paths
})
```

## API

### `new CssToTailwind(options?)`

### `converter.convert(css): Promise<ConvertResult>`

```ts
interface ConvertResult {
  nodes: {
    selector: string          // the original selector
    tailwindClasses: string[] // in Tailwind's class order
    complementary: string     // declarations that couldn't be converted, as CSS
  }[]
  warnings: {
    type: 'approximate-color' | 'unconvertible'
    selector: string          // the rule it came from
    declaration: string       // "color: #a1b2c3"
    message: string           // human-readable explanation
  }[]
}
```

`warnings` surfaces what the conversion glossed over — colors matched to a
*near* palette token rather than an exact one, and declarations left
unconverted:

```ts
const { warnings } = await convertCss('.a { color: #a1b2c3 }', { colorThreshold: 0.2 })
// [{ type: 'approximate-color', selector: '.a', declaration: 'color: #a1b2c3',
//    message: 'approximated #a1b2c3 to text-mist-400 (ΔE 0.039)' }]
```

### `convertCss(css, options?): Promise<ConvertResult>`

One-shot convenience wrapper around `new CssToTailwind(options).convert(css)`.

### `convertHtml(html, options?): Promise<{ html, warnings }>`

De-inlines a full HTML document — see [HTML — de-inline to classes](#html--de-inline-to-classes).
Also available from the `tailward/html` subpath. `options` extends the converter
options with `inline`, `styleRules`, and `keepStyleAttr`.

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `theme` | `string` | — | Custom `@theme` token overrides (engine-free, edge-safe). |
| `css` | `string` | — | Full CSS resolved by the Tailwind engine (Node only). |
| `base` | `string` | `process.cwd()` | Directory for resolving `@import`/`@plugin` in `css`. |
| `remInPx` | `number` | `16` | Pixel value of `1rem` for normalizing `px` inputs. |
| `arbitrary` | `boolean` | `true` | Emit arbitrary values when nothing matches; else keep as raw CSS. |
| `colorThreshold` | `number` | `0.02` | Max OKLab distance to match a palette color; `0` = exact only. |
| `canonicalize` | `boolean` | `true` | Prefer named functional utilities for bare numbers (`z-60` over `z-[60]`). |
| `important` | `boolean` | `false` | Preserve `!important` as the v4 trailing bang (`text-red-500!`, `sm:text-red-500!`); otherwise dropped. |
| `maxSpacingSteps` | `number` | `96` | Largest spacing multiplier reversed to a scale utility; larger lengths stay arbitrary (`600px` → `w-[600px]` not `w-150`). `Infinity` to reverse any multiple. |

## How it works

Tailwind only goes one way — class → CSS. To go the other way, this library
enumerates Tailwind's utilities, renders each to CSS via the v4 design system
(`__unstable__loadDesignSystem`), and inverts the result into a lookup, combined
with algorithmic matchers for colors (OKLab nearest), spacing, and font sizes.

For the stock theme this index is **pregenerated** into `src/generated` so no
engine is needed at runtime. The data splits into theme-independent entries
(`flex`, `w-full`) and token-derived entries (`rounded-lg` ← `--radius-lg`); the
latter are recomputed from whatever tokens are active, which is what makes the
custom-`theme` path work without the engine.

### Regenerating

The pregenerated index is committed and pinned to a `tailwindcss` version. After
bumping `tailwindcss`:

```sh
npm run generate
```

`stock-theme.test.ts` asserts the pregenerated output matches the live engine
across every indexed declaration, so CI fails if the data is stale.

## License

MIT
