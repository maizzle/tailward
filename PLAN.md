# tailward — feature roadmap

Implementation plan for the 8 features requested. Execute top-to-bottom; each
phase ships independently with tests. **After any change to the reverse index /
theme scales, run `npm run generate` and ensure `stock-theme.test.ts` (embedded
=== live) passes.** Conventions: ESM, `.ts` import specifiers, tsdown build,
vitest, oxlint (no config). Keep coverage ≥97% stmts / 100% funcs.

## Architecture recap (orientation)

- Package `tailward` at `~/Work/maizzle/csstotailwind` (dir kept; repo `maizzle/tailward`, private, `master`).
- Three paths in `src/converter.ts` (`CssToTailwind`): stock (engine-free embedded index), `{ theme }` (engine-free token overrides, edge-safe), `{ css }` (Node Tailwind engine via `__unstable__loadDesignSystem`, dynamically imported).
- Key modules: `converter.ts` (orchestration + `convertRule`), `css-parser.ts` (hand-rolled, `parseStylesheet` → `ParsedRule[]`), `color.ts` (OKLab), `reverse-index.ts` (builds/queries index; `computeMediaVariants`, `collectTextLineHeights`), `embedded.ts` (`loadEmbeddedIndex`/`loadThemeIndex`/`parseThemeTokens`/`themeMediaVariants`), `matchers/{spacing,color,arbitrary,shorthand}.ts`, `variants.ts` (`mediaVariant`, `canonicalizeMedia`, `selectorVariants`), `normalize.ts`.
- Generated data: `src/generated/stock-theme.ts` via `scripts/generate.ts` (`npm run generate`).
- `convert(css)` → `{ nodes: {selector, tailwindClasses, complementary}[], warnings: Warning[] }`. Options: `theme`, `css`, `base`, `remInPx=16`, `arbitrary=true`, `colorThreshold=0.02`, `canonicalize=true`, `maxSpacingSteps=96`.
- Runtime dep: `postcss-value-parser` only (edge-safe). Tests use htmlparser2/domutils from a sibling dir, NOT a tailward dep yet.

---

## Phase 1 — make it usable (highest value)

### 1. `convertHtml(html, options)` — the de-inline API
New `src/html.ts`, exported from `index.ts` AND as subpath `tailward/html` (keep core lean).
- Add deps: `htmlparser2`, `domutils`, `dom-serializer` (all pure-JS, edge-safe).
- Flow: `parseDocument(html)` → build `authoredMap` from `<style>` rules (convert each rule; `.sel` → classes) → walk elements; for each with `style`: convert → classes, map authored `class` tokens through `authoredMap`, merge (dedup + `orderClasses`), set `class`, delete `style`. Optionally drop converted `<style>` rules; keep unconvertible ones in a residual `<style>`.
- Signature: `class CssToTailwind { async convertHtml(html: string, opts?: { inline?: boolean; styleBlocks?: boolean; keepStyleAttr?: boolean }): Promise<{ html: string; warnings: Warning[] }> }`. Reuse the single converter instance.
- Merge/dedup: concat authored + converted, dedup, `orderClasses`. Conflict resolution (two classes, same property) is rare in this direction — last-wins by root is enough; do NOT add `tailwind-merge` as a dep (reimplement minimal dedup or skip).
- Serialize with `dom-serializer` (`encodeEntities: false`); preserve MSO conditional comments (they're comment nodes — skip, don't convert).
- Tests: inline styles, `<style>` blocks with `@media`/`:hover`, authored responsive classes, entity/comment preservation. Reuse the `mailviews/components` fixtures for a smoke test (don't commit them; reference by absolute path in a skipped/local test, or add a tiny fixture).

### 2. CLI
New `src/cli.ts` + `bin` entry. Node-only (uses `node:fs`).
- `package.json`: `"bin": { "tailward": "./dist/cli.js" }`; add shebang `#!/usr/bin/env node`; ensure tsdown emits it (add to `entry`).
- Args (tiny hand-rolled parser, no `citty`): `tailward [file]` (file or stdin), flags `--html` (use `convertHtml`), `--theme <file>`, `--css <file>`, `--rem <n>`, `--important`, `--out <file>`, `--watch`, `--summary`.
- `.html`/`--html` → `convertHtml` → write HTML; else → `convert` → print per-selector classes (or `--apply` → `@apply` output).
- `--watch`: `fs.watch`, re-run on change.
- Tests: spawn the built CLI on a temp file; assert stdout. Keep light.

### 3. `!important` preservation
Option `important?: boolean` (default `false`). `css-parser` already captures `decl.important`.
- Thread per-declaration importance into `convertDeclaration`/`convertRule`. When `options.important && decl.important`, suffix that declaration's produced classes with `!` (v4 trailing-bang: `text-red-500!`, `sm:text-red-500!`, `text-xl/7!`).
- Apply at the class level for THAT decl's classes only (not the whole rule) — track which classes came from important decls. Fusion/combine happen first, then append `!` to the resulting classes that trace to important decls (simplest: if the rule is entirely important, bang everything; else tag per-decl before fuse/combine and re-apply after).
- Ordering: `orderKey`/`stripVariants` must ignore a trailing `!` (strip it before ranking).
- Tests: `color:red !important` + `important:true` → `text-red-500!`; default (false) still strips.

---

## Phase 2 — correctness: composite-property decomposition

### 4. transform / filter / gradient
New `src/matchers/functions.ts`. Declaration-level converters returning `string[]`; wire into `convertSingle` BEFORE the arbitrary fallback.
- **transform**: parse value into functions (via `postcss-value-parser`). Map: `translateX(v)`→`translate-x-<spacing>` (reuse `matchSpacing`), `translateY`→`translate-y-*`, `translate(x,y)`→both, `scale(n)`→`scale-<n*100>`, `scaleX/Y`, `rotate(45deg)`→`rotate-45`, `skewX/Y(deg)`→`skew-x/y-*`. Unknown fn → arbitrary `[transform:…]`.
- **filter**: `blur(4px)`→`blur-<token>` (scale from `--blur-*`), `brightness(1.5)`→`brightness-150`, `contrast`, `grayscale`, `saturate`, `drop-shadow`, etc. Numeric → ×100 where relevant.
- **background / background-image**: `linear-gradient(to right, A, B)` → `bg-linear-to-r from-<A> to-<B>` (v4 `bg-linear-*`); parse direction (`to right`→`-r`, `to bottom`→`-b`, angles → arbitrary) + 2–3 color stops (from/via/to, colors via color matcher). Complex multi-stop → arbitrary.
- Verify each candidate on the engine path; trust + `numericRoots`-style gating on embedded. May need extra theme scale data (`--blur-*`, etc.) embedded → if so, extend `generate.ts` + regen.
- Tests per family; add corpus check if convenient.

---

## Phase 3 — polish

### 5. Source positions (opt-in)
- `css-parser` already walks offsets — track `start`/`end` char offsets (and compute line/col) on `ParsedDecl`/`ParsedRule` when `opts.positions` is set. Surface on result nodes. Enables editor "convert selection". Keep off by default (zero overhead).

### 6. Output helpers
- `toApply(result): string` → CSS with `@apply <classes>;` per selector. `toClassMap(result): Record<string,string>`. Small pure helpers in `index.ts`.

### 7. Conversion summary
- Add `summary: { converted, arbitrary, unconvertible, coverage }` to `ConvertResult`, tallied during `convertRule` (count named vs arbitrary-bracket vs complementary). Cheap.

### 8. Container queries
- `variants.ts`/`convertRule`: handle `@container (min-width: N)` at-rule context → `@min-[Npx]:` / named container variant; extend `atRuleVariants` to accept `container`. Lower priority.

---

## Sequencing & guardrails
- Order: 1 → 3 → 2 → (5,6,7,8). Ship each with tests; commit per feature.
- Deps added: `htmlparser2`, `domutils`, `dom-serializer` (Phase 1). Consider `tailward/html` subpath so the core edge bundle stays tiny.
- After transform/filter/gradient if any theme scale data gets embedded: `npm run generate`, verify `stock-theme.test.ts`.
- Always: `npx tsc --noEmit`, `npx oxlint`, `npx vitest run` green before commit. Keep README + options table in sync.
- Commit trailers per session; push to `origin/master` only when asked (user has been approving pushes).
