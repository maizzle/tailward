/** Escapes a value for use inside Tailwind's arbitrary-value brackets. */
function escapeArbitrary(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/_/g, '\\_') // literal underscores must be escaped
    .replace(/ /g, '_') // spaces become underscores
}

const BARE_VAR = /^var\(\s*(--[\w-]+)\s*\)$/

/** Builds an arbitrary-value utility, e.g. `p-[13px]` or `fill-(--brand)`. */
export function arbitraryUtility(root: string, value: string): string {
  const trimmed = value.trim()
  const varMatch = BARE_VAR.exec(trimmed)
  if (varMatch) return `${root}-(${varMatch[1]})`
  return `${root}-[${escapeArbitrary(trimmed)}]`
}

/** Builds an arbitrary-property utility, e.g. `[mask-type:luminance]`. */
export function arbitraryProperty(prop: string, value: string): string {
  return `[${prop}:${escapeArbitrary(value)}]`
}
