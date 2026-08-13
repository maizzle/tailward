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
}

export interface ConvertedNode {
  /** The original selector (without pseudo/at-rule context folded into variants). */
  selector: string
  /** Tailwind utility classes for this rule, in class order. */
  tailwindClasses: string[]
  /** Declarations that could not be converted, serialized back to CSS. */
  complementary: string
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

export interface ConvertResult {
  nodes: ConvertedNode[]
  /** Non-fatal notes: approximated colors and declarations left unconverted. */
  warnings: Warning[]
}
