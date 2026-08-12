import { describe, it, expect, beforeAll } from 'vitest'
import { CssToTailwind } from '../converter.ts'
import { loadDesignSystem, type DesignSystem } from '../design-system.ts'
import { buildReverseIndex, resolveClassDecls, type ReverseIndex } from '../reverse-index.ts'

let ds: DesignSystem
let index: ReverseIndex
let converter: CssToTailwind

beforeAll(async () => {
  ds = await loadDesignSystem()
  index = buildReverseIndex(ds, 16)
  converter = new CssToTailwind({ remInPx: 16 })
  await converter.convert('.x{}')
}, 60_000)

/** Canonical CSS signature of a class (its resolved declarations). */
function signature(className: string): string | null {
  const decls = resolveClassDecls(ds, className, index.vars)
  if (!decls) return null
  return decls
    .map((d) => `${d.prop}:${d.value.replace(/\s+/g, ' ').trim()}`)
    .sort()
    .join(';')
}

describe('round-trip: utility -> CSS -> utility', () => {
  it('recovers a CSS-equivalent utility for every indexed declaration', async () => {
    // Every entry in the index is a single-declaration utility we claim to support.
    const targets = [...new Set(index.decls.values())]
    const failures: string[] = []
    let checked = 0

    for (const name of targets) {
      const decls = resolveClassDecls(ds, name, index.vars)
      if (!decls || decls.length !== 1) continue
      const { prop, value } = decls[0]
      const { nodes } = await converter.convert(`.x { ${prop}: ${value}; }`)
      const got = nodes[0]?.tailwindClasses ?? []
      checked++

      if (got.length !== 1) {
        failures.push(`${name}: expected 1 class, got [${got.join(', ')}]`)
        continue
      }
      const expectedSig = signature(name)
      const gotSig = signature(got[0])
      if (expectedSig === null || gotSig === null || expectedSig !== gotSig) {
        failures.push(`${name} -> ${got[0]}: CSS mismatch (${gotSig} !== ${expectedSig})`)
      }
    }

    // Report a sample of failures for debuggability.
    if (failures.length) {
      console.error(`Round-trip failures (${failures.length}/${checked}):\n` + failures.slice(0, 20).join('\n'))
    }
    expect(failures).toEqual([])
    expect(checked).toBeGreaterThan(500)
  }, 120_000)

  it('recovers palette colors for every color token', async () => {
    const failures: string[] = []
    for (const [token, value] of index.palette) {
      const { nodes } = await converter.convert(`.x { color: ${value}; }`)
      const got = nodes[0]?.tailwindClasses ?? []
      // Some tokens (e.g. transparent/current) resolve to keyword utilities.
      if (got.length !== 1) {
        failures.push(`${token}: [${got.join(', ')}]`)
        continue
      }
      const sig = signature(got[0])
      const expected = signature(`text-${token}`)
      if (expected && sig !== expected) failures.push(`${token} -> ${got[0]}`)
    }
    if (failures.length) console.error('Color failures:\n' + failures.slice(0, 20).join('\n'))
    expect(failures).toEqual([])
  }, 60_000)
})
