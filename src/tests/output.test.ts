import { describe, it, expect, beforeAll } from 'vitest'
import { CssToTailwind } from '../converter.ts'
import { toApply, toClassMap } from '../index.ts'

let c: CssToTailwind
beforeAll(async () => {
  c = new CssToTailwind()
  await c.convert('.x{}')
}, 60_000)

describe('toApply', () => {
  it('renders @apply blocks, keeping complementary CSS', async () => {
    const result = await c.convert('.a { display: flex; padding: 1rem; } .b { animation-timeline: view(); }')
    expect(toApply(result)).toBe('.a { @apply flex p-4; }\n.b { @apply [animation-timeline:view()]; }')
  })

  it('keeps unconvertible declarations as raw CSS when arbitrary is off', async () => {
    const c2 = new CssToTailwind({ arbitrary: false })
    const result = await c2.convert('.b { animation-timeline: view(); }')
    expect(toApply(result)).toBe('.b { animation-timeline: view(); }')
  })
})

describe('toClassMap', () => {
  it('maps selectors to their utility classes', async () => {
    const result = await c.convert('.a { display: flex; } .b { display: block; }')
    expect(toClassMap(result)).toEqual({ '.a': 'flex', '.b': 'block' })
  })
})

describe('summary', () => {
  it('tallies converted, unconvertible, arbitrary, and coverage', async () => {
    const c2 = new CssToTailwind({ arbitrary: true })
    const result = await c2.convert('.a { display: flex; width: 33%; } .b { animation-timeline: view(); }')
    // flex (named) + w-[33%] (arbitrary) converted; animation-timeline arbitrary too.
    expect(result.summary.converted).toBe(3)
    expect(result.summary.unconvertible).toBe(0)
    expect(result.summary.arbitrary).toBe(2)
    expect(result.summary.coverage).toBe(1)
  })

  it('reports partial coverage and counts unconvertible declarations', async () => {
    const c2 = new CssToTailwind({ arbitrary: false })
    const result = await c2.convert('.a { display: flex; animation-timeline: view(); }')
    expect(result.summary).toEqual({ converted: 1, unconvertible: 1, arbitrary: 0, coverage: 0.5 })
  })

  it('is fully covered when there is nothing to convert', async () => {
    const result = await c.convert('.a {}')
    expect(result.summary).toEqual({ converted: 0, unconvertible: 0, arbitrary: 0, coverage: 1 })
  })
})
