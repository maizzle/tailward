import type { ReverseIndex } from './reverse-index.ts'
import { stockTheme } from './generated/stock-theme.ts'

/** Serialized form of a design system's reverse index (JSON-friendly). */
export interface StockTheme {
  tailwindVersion: string
  spacingBaseRem: number
  /** Only the `--breakpoint-*` vars are needed at runtime (for responsive variants). */
  vars: Record<string, string>
  decls: Record<string, string>
  propToRoot: Record<string, string>
  colorRoots: Record<string, string>
  spacingRoots: string[]
  textSizes: Record<string, string>
  palette: Record<string, string>
  numericRoots: string[]
  rootRanks: Record<string, number>
}

/**
 * Rebuilds a {@link ReverseIndex} from the pregenerated stock-theme data —
 * no Tailwind engine, no `node:fs`, so it runs in edge/worker runtimes.
 * The data is rem-independent (values are stored in rem), so `remInPx` is unused.
 */
export function loadEmbeddedIndex(_remInPx: number): ReverseIndex {
  return {
    decls: new Map(Object.entries(stockTheme.decls)),
    propToRoot: new Map(Object.entries(stockTheme.propToRoot)),
    colorRoots: new Map(Object.entries(stockTheme.colorRoots)),
    palette: new Map(Object.entries(stockTheme.palette)),
    textSizes: new Map(Object.entries(stockTheme.textSizes)),
    spacingRoots: new Set(stockTheme.spacingRoots),
    spacingBaseRem: stockTheme.spacingBaseRem,
    numericRoots: new Set(stockTheme.numericRoots),
    rootRanks: new Map(Object.entries(stockTheme.rootRanks)),
    vars: new Map(Object.entries(stockTheme.vars)),
  }
}
