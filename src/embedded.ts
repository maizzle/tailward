import type { ReverseIndex } from './reverse-index.ts'
import { declKey } from './reverse-index.ts'
import { normalizeLength } from './normalize.ts'
import { parseStylesheet } from './css-parser.ts'
import { stockTheme } from './generated/stock-theme.ts'

/** Serialized reverse index for a theme (JSON-friendly, engine-free). */
export interface StockTheme {
  tailwindVersion: string
  /** All non-color theme vars (`--spacing`, `--radius-*`, `--breakpoint-*`, ...). */
  themeVars: Record<string, string>
  /** `--color-*` token -> value. */
  palette: Record<string, string>
  /** Theme-independent entries: `prop|value` -> class (`display|flex` -> `flex`). */
  plainDecls: Record<string, string>
  /** Token-derived entries: `[prop, varName, class]` (`border-radius`, `--radius-lg`, `rounded-lg`). */
  tokenDecls: [string, string, string][]
  propToRoot: Record<string, string>
  colorRoots: Record<string, string>
  spacingRoots: string[]
  numericRoots: string[]
  rootRanks: Record<string, number>
}

const clean = (v: string) => v.replace(/\s+/g, ' ').trim()

/**
 * Builds a {@link ReverseIndex} from serialized theme data — no Tailwind engine,
 * no `node:fs`, so it runs on edge. Token-derived entries are recomputed from
 * `themeVars`, so overriding a var (custom `@theme`) yields a correct index.
 */
export function buildIndexFromTokens(
  data: StockTheme,
  remInPx: number,
  overrides?: { vars?: Record<string, string>; colors?: Record<string, string> },
): ReverseIndex {
  const themeVars = { ...data.themeVars, ...overrides?.vars }
  const paletteObj = { ...data.palette, ...overrides?.colors }

  const decls = new Map(Object.entries(data.plainDecls))
  for (const [prop, varName, cls] of data.tokenDecls) {
    const value = themeVars[varName]
    if (value) decls.set(declKey(prop, clean(value), remInPx), cls)
  }

  const spacingBaseRem = (() => {
    const n = normalizeLength(themeVars['--spacing'] ?? '0.25rem', remInPx)
    return n ? parseFloat(n) : 0.25
  })()

  const textSizes = new Map<string, string>()
  for (const [name, value] of Object.entries(themeVars)) {
    if (name.startsWith('--text-') && !name.includes('--line-height')) {
      const rem = normalizeLength(value, remInPx)
      if (rem) textSizes.set(rem, name.slice('--text-'.length))
    }
  }

  return {
    decls,
    propToRoot: new Map(Object.entries(data.propToRoot)),
    colorRoots: new Map(Object.entries(data.colorRoots)),
    palette: new Map(Object.entries(paletteObj)),
    textSizes,
    spacingRoots: new Set(data.spacingRoots),
    spacingBaseRem,
    numericRoots: new Set(data.numericRoots),
    rootRanks: new Map(Object.entries(data.rootRanks)),
    vars: new Map(Object.entries(themeVars)),
  }
}

/** The stock (default Tailwind theme) reverse index — engine-free. */
export function loadEmbeddedIndex(remInPx: number): ReverseIndex {
  return buildIndexFromTokens(stockTheme, remInPx)
}

/** Extracts `--*` custom properties (theme tokens) from a CSS string. */
export function parseThemeTokens(css: string): { vars: Record<string, string>; colors: Record<string, string> } {
  const vars: Record<string, string> = {}
  const colors: Record<string, string> = {}
  for (const rule of parseStylesheet(css)) {
    for (const d of rule.decls) {
      if (!d.prop.startsWith('--')) continue
      if (d.prop.startsWith('--color-')) colors[d.prop.slice('--color-'.length)] = d.value
      else vars[d.prop] = d.value
    }
  }
  return { vars, colors }
}

/**
 * Builds a reverse index for a custom `@theme` by overriding the stock tokens —
 * engine-free, so custom themes work on edge. Only token overrides (colors,
 * spacing, radius, ...) are supported; `@plugin`/`@utility` need the `css`
 * (Node engine) path.
 */
export function loadThemeIndex(themeCss: string, remInPx: number): ReverseIndex {
  return buildIndexFromTokens(stockTheme, remInPx, parseThemeTokens(themeCss))
}
