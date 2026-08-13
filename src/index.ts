export { CssToTailwind } from './converter.ts'
export { convertHtml } from './html.ts'
export type { ConvertHtmlOptions, ConvertHtmlResult } from './html.ts'
export type { ConverterOptions, ConvertResult, ConvertedNode, ConversionSummary, Warning } from './types.ts'

import { CssToTailwind } from './converter.ts'
import type { ConverterOptions, ConvertResult } from './types.ts'

/**
 * Convenience one-shot conversion. For repeated conversions, construct a
 * {@link CssToTailwind} once and reuse it to avoid rebuilding the index.
 */
export async function convertCss(css: string, options?: ConverterOptions): Promise<ConvertResult> {
  return new CssToTailwind(options).convert(css)
}

/**
 * Renders a result as CSS `@apply` rules, one per selector — a copy-pasteable
 * stylesheet. Declarations that couldn't convert are kept as raw CSS in the block.
 */
export function toApply(result: ConvertResult): string {
  return result.nodes
    .map((node) => {
      const parts: string[] = []
      if (node.tailwindClasses.length) parts.push(`@apply ${node.tailwindClasses.join(' ')};`)
      if (node.complementary) parts.push(`${node.complementary};`)
      return `${node.selector} { ${parts.join(' ')} }`
    })
    .join('\n')
}

/** Maps each selector to its space-joined utility classes (`{ '.a': 'flex p-4' }`). */
export function toClassMap(result: ConvertResult): Record<string, string> {
  const map: Record<string, string> = {}
  for (const node of result.nodes) map[node.selector] = node.tailwindClasses.join(' ')
  return map
}
