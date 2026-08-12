export { CssToTailwind } from './converter.ts'
export type { ConverterOptions, ConvertResult, ConvertedNode } from './types.ts'

import { CssToTailwind } from './converter.ts'
import type { ConverterOptions, ConvertResult } from './types.ts'

/**
 * Convenience one-shot conversion. For repeated conversions, construct a
 * {@link CssToTailwind} once and reuse it to avoid rebuilding the index.
 */
export async function convertCss(css: string, options?: ConverterOptions): Promise<ConvertResult> {
  return new CssToTailwind(options).convert(css)
}
