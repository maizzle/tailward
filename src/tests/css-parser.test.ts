import { describe, it, expect } from 'vitest'
import { parseStylesheet } from '../css-parser.ts'

describe('parseStylesheet', () => {
  it('splits a selector list on top-level commas', () => {
    const [rule] = parseStylesheet('.a, .b, .c { color: red }')
    expect(rule.selectors).toEqual(['.a', '.b', '.c'])
  })

  it('does not split commas inside :not()/[...]', () => {
    const [rule] = parseStylesheet('.a:not(.b, .c)[data-x="1,2"] { color: red }')
    expect(rule.selectors).toEqual(['.a:not(.b, .c)[data-x="1,2"]'])
  })

  it('parses declarations and drops comments', () => {
    const [rule] = parseStylesheet('.a { /* note */ color: red; padding: 4px }')
    expect(rule.decls).toEqual([
      { prop: 'color', value: 'red', important: false },
      { prop: 'padding', value: '4px', important: false },
    ])
  })

  it('skips malformed declarations (no colon, empty prop)', () => {
    const [rule] = parseStylesheet('.a { color red; : blue; display: block }')
    expect(rule.decls).toEqual([{ prop: 'display', value: 'block', important: false }])
  })

  it('captures !important', () => {
    const [rule] = parseStylesheet('.a { color: red !important }')
    expect(rule.decls[0]).toEqual({ prop: 'color', value: 'red', important: true })
  })

  it('tolerates an unterminated rule', () => {
    const [rule] = parseStylesheet('.a { color: red')
    expect(rule.selectors).toEqual(['.a'])
    expect(rule.decls[0]).toMatchObject({ prop: 'color', value: 'red' })
  })

  it('treats a bare declaration list as an anonymous rule', () => {
    const rules = parseStylesheet('color: red; padding: 4px')
    expect(rules).toHaveLength(1)
    expect(rules[0].selectors).toEqual([''])
    expect(rules[0].decls).toHaveLength(2)
  })

  it('carries at-rule context and drops `;` inside quotes', () => {
    const [rule] = parseStylesheet('@media (min-width: 40rem) { .a { content: "a;b"; color: red } }')
    expect(rule.atRules).toEqual([{ name: 'media', params: '(min-width: 40rem)' }])
    expect(rule.decls).toContainEqual({ prop: 'content', value: '"a;b"', important: false })
  })
})
