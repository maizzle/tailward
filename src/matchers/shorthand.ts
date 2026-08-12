/** A single expanded piece of a box shorthand, as a longhand declaration. */
export interface BoxPart {
  /** The longhand CSS property (axis-logical like `padding-block`, or physical like `margin-top`). */
  prop: string
  /** The value for this part. */
  value: string
}

interface BoxDef {
  top: string
  right: string
  bottom: string
  left: string
  block: string // vertical axis (v4 `py`/`my` are logical block properties)
  inline: string // horizontal axis (v4 `px`/`mx` are logical inline properties)
}

const BOX: Record<string, BoxDef> = {
  padding: {
    top: 'padding-top', right: 'padding-right', bottom: 'padding-bottom', left: 'padding-left',
    block: 'padding-block', inline: 'padding-inline',
  },
  margin: {
    top: 'margin-top', right: 'margin-right', bottom: 'margin-bottom', left: 'margin-left',
    block: 'margin-block', inline: 'margin-inline',
  },
}

/** Splits on whitespace, ignoring spaces nested in (), [] (e.g. `calc(a b)`). */
function splitValues(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of value.trim()) {
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    if (/\s/.test(ch) && depth === 0) {
      if (cur) {
        parts.push(cur)
        cur = ''
      }
    } else cur += ch
  }
  if (cur) parts.push(cur)
  return parts
}

/**
 * Expands a `padding`/`margin` shorthand of 2-4 values into axis/directional
 * parts (`padding: 0 24px` -> `py-0` + `px-6`), collapsing equal opposite sides
 * to an axis utility. Returns null for single values (handled as one utility)
 * or non-box properties.
 */
export function expandBoxShorthand(prop: string, value: string): BoxPart[] | null {
  const box = BOX[prop]
  if (!box) return null

  const v = splitValues(value)
  if (v.length < 2 || v.length > 4) return null

  // Normalize to [top, right, bottom, left].
  const [top, right, bottom, left] =
    v.length === 2 ? [v[0], v[1], v[0], v[1]]
    : v.length === 3 ? [v[0], v[1], v[2], v[1]]
    : [v[0], v[1], v[2], v[3]]

  const parts: BoxPart[] = []

  // Collapse equal opposite sides to the axis (logical) property, else keep physical.
  if (top === bottom) parts.push({ prop: box.block, value: top })
  else parts.push({ prop: box.top, value: top }, { prop: box.bottom, value: bottom })

  if (left === right) parts.push({ prop: box.inline, value: left })
  else parts.push({ prop: box.right, value: right }, { prop: box.left, value: left })

  return parts
}
