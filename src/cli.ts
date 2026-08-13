#!/usr/bin/env node
/**
 * `tailward` CLI. Node-only (reads/writes files and stdin). Converts a CSS file
 * (or stdin) to Tailwind utilities, or de-inlines an HTML document with `--html`.
 */
import { readFileSync, writeFileSync, watch, realpathSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CssToTailwind } from './converter.ts'
import { convertHtml } from './html.ts'
import { toApply } from './index.ts'
import type { ConversionSummary, ConvertResult, ConverterOptions } from './types.ts'

const HELP = `tailward — convert CSS to Tailwind v4 utility classes

Usage:
  tailward [file] [options]
  cat styles.css | tailward

Options:
  --html            De-inline an HTML document (auto-enabled for .html/.htm)
  --theme <file>    Convert against a custom @theme file (engine-free)
  --css <file>      Convert against full CSS via the Tailwind engine
  --rem <n>         Pixel value of 1rem (default 16)
  --important       Preserve !important as the v4 trailing bang
  --out <file>      Write output to a file instead of stdout
  --json            Output the raw conversion result as JSON (CSS mode)
  --summary         Print a conversion summary to stderr
  --watch           Re-run when the input file changes
  -h, --help        Show this help
`

export interface CliArgs {
  file?: string
  html: boolean
  json: boolean
  summary: boolean
  watch: boolean
  help: boolean
  important: boolean
  out?: string
  theme?: string
  css?: string
  rem?: number
}

/** Parses argv (without `node script`) into structured options. Throws on misuse. */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { html: false, json: false, summary: false, watch: false, help: false, important: false }
  const valueFlags = new Set(['--theme', '--css', '--rem', '--out'])

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    if (raw === '-h' || raw === '--help') { args.help = true; continue }
    const eq = raw.startsWith('--') ? raw.indexOf('=') : -1
    const flag = eq === -1 ? raw : raw.slice(0, eq)
    const inlineValue = eq === -1 ? undefined : raw.slice(eq + 1)
    const takeValue = () => {
      const v = inlineValue ?? argv[++i]
      if (v === undefined) throw new Error(`missing value for ${flag}`)
      return v
    }

    if (flag === '--html') args.html = true
    else if (flag === '--json') args.json = true
    else if (flag === '--summary') args.summary = true
    else if (flag === '--watch') args.watch = true
    else if (flag === '--important') args.important = true
    else if (flag === '--theme') args.theme = takeValue()
    else if (flag === '--css') args.css = takeValue()
    else if (flag === '--out') args.out = takeValue()
    else if (flag === '--rem') {
      const n = Number(takeValue())
      if (!Number.isFinite(n) || n <= 0) throw new Error(`--rem expects a positive number`)
      args.rem = n
    } else if (valueFlags.has(flag)) throw new Error(`missing value for ${flag}`)
    else if (raw.startsWith('-') && raw !== '-') throw new Error(`unknown option: ${raw}`)
    else if (args.file === undefined) args.file = raw
    else throw new Error(`unexpected argument: ${raw}`)
  }
  return args
}

/** One-line tally of a conversion for `--summary`. */
export function summaryLine(summary: ConversionSummary): string {
  const { converted, unconvertible, arbitrary, coverage } = summary
  return `${converted} converted, ${unconvertible} unconvertible, ${arbitrary} arbitrary — ${Math.round(coverage * 100)}% coverage`
}

/** Builds converter options from parsed args, reading `--theme`/`--css` files. */
function toConverterOptions(args: CliArgs): ConverterOptions {
  const options: ConverterOptions = { important: args.important }
  if (args.rem !== undefined) options.remInPx = args.rem
  if (args.theme) options.theme = readFileSync(args.theme, 'utf8')
  if (args.css) {
    options.css = readFileSync(args.css, 'utf8')
    options.base = dirname(args.css)
  }
  return options
}

/** Runs one conversion pass and writes the result. */
async function runOnce(args: CliArgs): Promise<void> {
  const input = args.file ? readFileSync(args.file, 'utf8') : readFileSync(0, 'utf8')
  const options = toConverterOptions(args)
  const isHtml = args.html || (args.file ? /\.html?$/i.test(args.file) : false)

  let output: string
  let warnings: ConvertResult['warnings']
  if (isHtml) {
    const result = await convertHtml(input, options)
    output = result.html
    warnings = result.warnings
  } else {
    const result = await new CssToTailwind(options).convert(input)
    warnings = result.warnings
    output = args.json ? JSON.stringify(result, null, 2) : toApply(result)
    if (args.summary) process.stderr.write(`${summaryLine(result.summary)}\n`)
  }

  if (args.summary && isHtml) process.stderr.write(`${warnings.length} warnings\n`)
  if (args.out) writeFileSync(args.out, `${output}\n`)
  else process.stdout.write(`${output}\n`)
}

export async function main(argv: string[]): Promise<void> {
  let args: CliArgs
  try {
    args = parseArgs(argv)
  } catch (err) {
    process.stderr.write(`tailward: ${(err as Error).message}\n\n${HELP}`)
    process.exitCode = 1
    return
  }
  if (args.help) {
    process.stdout.write(HELP)
    return
  }
  if (args.watch && !args.file) {
    process.stderr.write('tailward: --watch requires a file argument\n')
    process.exitCode = 1
    return
  }

  try {
    await runOnce(args)
  } catch (err) {
    process.stderr.write(`tailward: ${(err as Error).message}\n`)
    process.exitCode = 1
    return
  }

  /* v8 ignore start -- fs.watch side effect, not unit-testable */
  if (args.watch && args.file) {
    process.stderr.write(`tailward: watching ${args.file}…\n`)
    watch(args.file, () => {
      runOnce(args).catch((err: Error) => process.stderr.write(`tailward: ${err.message}\n`))
    })
  }
  /* v8 ignore stop */
}

// Run only when invoked as the entry point (realpath handles the npm bin symlink),
// so importing the module for tests doesn't read stdin or exit.
/* v8 ignore start -- entry-point guard, only taken when run as a bin */
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2))
}
/* v8 ignore stop */
