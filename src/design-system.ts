import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { __unstable__loadDesignSystem } from 'tailwindcss'

const require = createRequire(import.meta.url)

/**
 * Minimal shape of the Tailwind v4 design system we rely on. The real type lives
 * behind an `__unstable__` export, so we describe only what we use.
 */
export interface DesignSystem {
  theme: {
    values: Map<string, { value: string }>
    resolveValue(candidate: string | null, namespaces: string[]): string | null
  }
  getClassList(): [string, { modifiers: string[] }][]
  getVariants(): { name: string }[]
  candidatesToCss(classes: string[]): (string | null)[]
  parseCandidate(candidate: string): readonly ParsedCandidate[]
  canonicalizeCandidates(candidates: string[]): string[]
  getClassOrder(classes: string[]): [string, bigint | null][]
}

export interface ParsedCandidate {
  kind: 'functional' | 'static' | 'arbitrary'
  root: string
  value: { kind: 'named' | 'arbitrary'; value: string } | null
}

const DEFAULT_CSS = '@import "tailwindcss";'

/** Resolves an `@import` id (bare package or relative path) to a CSS file. */
function resolveStylesheet(id: string, base: string): string {
  if (id.startsWith('.') || isAbsolute(id)) {
    return resolve(base, id)
  }
  if (id.endsWith('.css')) return require.resolve(id, { paths: [base] })
  // Bare package: prefer its own CSS entry (e.g. `@maizzle/tailwindcss` exports
  // `.` -> index.css); fall back to `<pkg>/index.css` for packages whose main
  // isn't CSS (e.g. `tailwindcss`, whose main is JS but exposes `./index.css`).
  try {
    const resolved = require.resolve(id, { paths: [base] })
    if (resolved.endsWith('.css')) return resolved
  } catch {
    // not resolvable as-is; try the index.css subpath below
  }
  return require.resolve(`${id}/index.css`, { paths: [base] })
}

/** Loads a Tailwind v4 design system from CSS (defaults to the stock theme). */
export async function loadDesignSystem(css = DEFAULT_CSS, base = process.cwd()): Promise<DesignSystem> {
  const ds = await __unstable__loadDesignSystem(css, {
    base,
    async loadStylesheet(id: string, importBase: string) {
      const path = resolveStylesheet(id, importBase)
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') }
    },
    async loadModule(id: string, importBase: string) {
      const path = id.startsWith('.') || isAbsolute(id) ? resolve(importBase, id) : require.resolve(id, { paths: [importBase] })
      const mod = await import(pathToFileURL(path).href)
      return { path, base: dirname(path), module: mod.default ?? mod }
    },
  })
  return ds as unknown as DesignSystem
}
