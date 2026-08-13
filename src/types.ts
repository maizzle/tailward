export interface ConverterOptions {
  /**
   * A custom `@theme` (CSS custom properties) to convert against — engine-free,
   * so it runs on edge/workers. Overrides stock tokens (colors, spacing, radius,
   * font sizes, ...). For `@plugin`/`@utility` or `@import`, use `css` instead.
   * @example theme: '@theme { --color-brand: #5b21b6; --spacing: 0.2rem; }'
   */
  theme?: string
  /**
   * Full CSS used to load the Tailwind design system via its engine (Node only).
   * Pass this for `@plugin`, custom `@utility`, or `@import`. Defaults to the
   * stock theme (engine-free) when omitted.
   */
  css?: string
  /** Base directory used to resolve `@import` statements in `css`. Defaults to `process.cwd()`. */
  base?: string
  /**
   * Pixel value of `1rem`, used to normalize `px` inputs against the (rem-based) theme.
   * @default 16
   */
  remInPx?: number
  /**
   * Emit arbitrary-value utilities (`p-[13px]`, `bg-[#123456]`) when no theme token matches.
   * When `false`, unmatched declarations are kept as complementary CSS instead.
   * @default true
   */
  arbitrary?: boolean
  /**
   * Maximum OKLab distance for a color to be matched to a palette token instead of an
   * arbitrary value. Set to `0` to only match exact palette colors.
   * @default 0.02
   */
  colorThreshold?: number
  /**
   * Prefer a named functional utility over an arbitrary one for bare-number
   * values (e.g. `z-index: 60` -> `z-60`, `order: 13` -> `order-13`) instead of
   * `z-[60]` / `order-[13]`. Each candidate is verified against the engine.
   * @default true
   */
  canonicalize?: boolean
  /**
   * Attach a `position` (source offsets + line/column) to each converted node, so an
   * editor integration can map a rule back to its place in the input. Off by default.
   * @default false
   */
  positions?: boolean
  /**
   * Preserve `!important` from the source by emitting the v4 trailing-bang form
   * (`color: red !important` -> `text-red-500!`, `sm:text-red-500!`). When `false`,
   * importance is dropped and the utility is emitted plain.
   * @default false
   */
  important?: boolean
  /**
   * Largest spacing multiplier to emit as a scale utility. Lengths whose
   * multiplier exceeds it become arbitrary values instead (`width: 600px` ->
   * `w-[600px]` rather than `w-150`). Defaults to Tailwind's spacing-scale
   * ceiling (96) — in-range dynamic steps like `p-13` still reverse; set
   * `Infinity` to reverse any multiple, or a lower number to be stricter.
   * @default 96
   */
  maxSpacingSteps?: number
}

export interface SourcePosition {
  /** Char offset of the rule's start in the input. */
  start: number
  /** Char offset just past the rule's closing brace. */
  end: number
  /** 1-based line of the rule's start. */
  line: number
  /** 1-based column of the rule's start. */
  column: number
}

export interface ConvertedNode {
  /** The original selector (without pseudo/at-rule context folded into variants). */
  selector: string
  /** Tailwind utility classes for this rule, in class order. */
  tailwindClasses: string[]
  /** Declarations that could not be converted, serialized back to CSS. */
  complementary: string
  /** Source span of the originating rule. Present only when the `positions` option is on. */
  position?: SourcePosition
}

export interface Warning {
  /** `approximate-color`: matched to a near palette token, not exact. `unconvertible`: no utility found. */
  type: 'approximate-color' | 'unconvertible'
  /** The rule this declaration belonged to. */
  selector: string
  /** The offending declaration, as CSS (`color: #a1b2c3`). */
  declaration: string
  /** Human-readable explanation. */
  message: string
}

export interface ConversionSummary {
  /** Declarations that produced at least one utility class. */
  converted: number
  /** Declarations left as complementary CSS (no utility found). */
  unconvertible: number
  /** Emitted utilities that use an arbitrary value or property (`p-[13px]`, `[mask-type:…]`). */
  arbitrary: number
  /** `converted / (converted + unconvertible)`, or `1` when there was nothing to convert. */
  coverage: number
}

export interface ConvertResult {
  nodes: ConvertedNode[]
  /** Non-fatal notes: approximated colors and declarations left unconverted. */
  warnings: Warning[]
  /** Tally of how much of the input converted. */
  summary: ConversionSummary
}
