import valueParser from 'postcss-value-parser'

/** Recursively replaces `var(--x[, fallback])` using a resolved theme variable map. */
export function resolveVars(value: string, vars: Map<string, string>, depth = 0): string {
  if (depth > 10 || !value.includes('var(')) return value

  const parsed = valueParser(value)
  parsed.walk((node) => {
    if (node.type === 'function' && node.value === 'var') {
      const nameNode = node.nodes[0]
      const name = nameNode?.value
      const fallback = node.nodes.slice(2) // skip name + divider
      const resolved = name ? vars.get(name) : undefined
      const replacement = resolved ?? (fallback.length ? valueParser.stringify(fallback) : '')
      // Rewrite this function node into a plain word so stringify emits the value.
      const word = node as unknown as { type: string; value: string; nodes: [] }
      word.type = 'word'
      word.value = replacement
      word.nodes = []
      return false
    }
  })

  const out = parsed.toString()
  return out.includes('var(') ? resolveVars(out, vars, depth + 1) : out
}

/**
 * Evaluates the simple `calc()` expressions Tailwind emits, e.g.
 * `calc(0.25rem * 4)` -> `1rem`, `calc(1.5 / 0.875)` -> `1.714...`.
 * Leaves anything it can't confidently evaluate untouched.
 */
export function evalCalc(value: string): string {
  if (!value.includes('calc(')) return value

  let out = value
  let guard = 0
  while (out.includes('calc(') && guard++ < 10) {
    const start = out.indexOf('calc(')
    const open = start + 4
    const close = matchParen(out, open)
    if (close === -1) break
    const inner = out.slice(open + 1, close)
    // Only collapse innermost calc() (no nested parens) to keep evaluation simple.
    if (inner.includes('(')) {
      // Try a deeper calc first by scanning past this one.
      const nested = out.indexOf('calc(', open)
      if (nested !== -1 && nested < close) {
        out = replaceRange(out, nested, matchParen(out, nested + 4) + 1, evalCalc(out.slice(nested, matchParen(out, nested + 4) + 1)))
        continue
      }
      break
    }
    const result = evaluate(inner)
    if (result === null) break
    out = replaceRange(out, start, close + 1, formatNumber(result.n) + result.unit)
  }
  return out
}

function matchParen(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')' && --depth === 0) return i
  }
  return -1
}

function replaceRange(s: string, start: number, end: number, insert: string): string {
  return s.slice(0, start) + insert + s.slice(end)
}

interface Num {
  n: number
  unit: string
}

/** Evaluates a flat arithmetic expression like `0.25rem * 4` or `1.5 / 0.875`. */
function evaluate(expr: string): Num | null {
  const tokens = expr.trim().split(/\s+/)
  if (tokens.length % 2 === 0) return null // must be operand (op operand)*

  let acc = parseNumber(tokens[0])
  if (!acc) return null
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i]
    const rhs = parseNumber(tokens[i + 1])
    if (!rhs) return null
    if (op === '*') acc = mul(acc, rhs)
    else if (op === '/') acc = div(acc, rhs)
    else if (op === '+') acc = addSub(acc, rhs, 1)
    else if (op === '-') acc = addSub(acc, rhs, -1)
    else return null
    if (!acc) return null
  }
  return acc
}

function mul(a: Num, b: Num): Num | null {
  if (a.unit && b.unit) return null
  return { n: a.n * b.n, unit: a.unit || b.unit }
}

function div(a: Num, b: Num): Num | null {
  if (b.unit) return null
  return { n: a.n / b.n, unit: a.unit }
}

function addSub(a: Num, b: Num, sign: number): Num | null {
  if (a.unit !== b.unit) return null
  return { n: a.n + sign * b.n, unit: a.unit }
}

function parseNumber(word: string): Num | null {
  const m = /^(-?\d*\.?\d+)([a-z%]*)$/i.exec(word)
  if (!m) return null
  return { n: parseFloat(m[1]), unit: m[2].toLowerCase() }
}

function formatNumber(n: number): string {
  return parseFloat(n.toFixed(5)).toString()
}

/**
 * Normalizes a length to a canonical `rem` string when possible so `1rem`,
 * `16px` (with remInPx 16) and `calc(...)` results all compare equal.
 */
export function normalizeLength(value: string, remInPx: number): string | null {
  const num = parseNumber(value.trim())
  if (!num) return null
  if (num.n === 0) return '0'
  if (num.unit === 'rem') return formatNumber(num.n) + 'rem'
  if (num.unit === 'px') return formatNumber(num.n / remInPx) + 'rem'
  return null
}

/** Generic value normalization for exact index matching (non-color, non-length). */
export function normalizeValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}
