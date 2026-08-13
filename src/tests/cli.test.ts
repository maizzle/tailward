import { describe, it, expect, vi, afterEach } from 'vitest'
import { writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseArgs, summaryLine, main } from '../cli.ts'

describe('parseArgs', () => {
  it('reads a positional file and boolean flags', () => {
    const a = parseArgs(['styles.css', '--html', '--important', '--summary'])
    expect(a).toMatchObject({ file: 'styles.css', html: true, important: true, summary: true })
  })

  it('reads value flags in both space and = forms', () => {
    expect(parseArgs(['--rem', '8', '--out', 'x.css'])).toMatchObject({ rem: 8, out: 'x.css' })
    expect(parseArgs(['--rem=10', '--theme=t.css'])).toMatchObject({ rem: 10, theme: 't.css' })
  })

  it('rejects a non-positive or non-numeric --rem', () => {
    expect(() => parseArgs(['--rem', 'x'])).toThrow(/positive number/)
    expect(() => parseArgs(['--rem', '0'])).toThrow(/positive number/)
  })

  it('throws on a missing value, unknown option, or extra argument', () => {
    expect(() => parseArgs(['--theme'])).toThrow(/missing value/)
    expect(() => parseArgs(['--nope'])).toThrow(/unknown option/)
    expect(() => parseArgs(['a.css', 'b.css'])).toThrow(/unexpected argument/)
  })

  it('recognizes help', () => {
    expect(parseArgs(['-h']).help).toBe(true)
    expect(parseArgs(['--help']).help).toBe(true)
  })
})

describe('summaryLine', () => {
  it('formats a conversion summary', () => {
    expect(summaryLine({ converted: 3, unconvertible: 1, arbitrary: 2, coverage: 0.75 })).toBe(
      '3 converted, 1 unconvertible, 2 arbitrary — 75% coverage',
    )
  })
})

describe('main', () => {
  const tmp = join(tmpdir(), `tailward-cli-${process.pid}`)
  const files: string[] = []
  const write = (name: string, content: string) => {
    const path = `${tmp}-${name}`
    writeFileSync(path, content)
    files.push(path)
    return path
  }

  afterEach(() => {
    for (const f of files.splice(0)) rmSync(f, { force: true })
    vi.restoreAllMocks()
    process.exitCode = 0
  })

  const capture = () => {
    const out: string[] = []
    const err: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => (out.push(String(s)), true))
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => (err.push(String(s)), true))
    return { out, err }
  }

  it('converts a CSS file to @apply output on stdout', async () => {
    const css = write('a.css', '.btn { display: flex; padding: 16px; }')
    const { out } = capture()
    await main([css])
    expect(out.join('')).toBe('.btn { @apply flex p-4; }\n')
  })

  it('de-inlines an .html file and honors --important', async () => {
    const html = write('a.html', '<div style="color:#fb2c36 !important">x</div>')
    const { out } = capture()
    await main([html, '--important'])
    expect(out.join('')).toBe('<div class="text-red-500!">x</div>\n')
  })

  it('writes to --out and prints a summary to stderr', async () => {
    const css = write('b.css', '.a { display: block; }')
    const outFile = `${tmp}-out.css`
    files.push(outFile)
    const { out, err } = capture()
    await main([css, '--out', outFile, '--summary'])
    expect(out.join('')).toBe('') // nothing on stdout when --out is used
    expect(err.join('')).toContain('1 converted')
    expect(readFileSync(outFile, 'utf8')).toBe('.a { @apply block; }\n')
  })

  it('converts against a --theme file', async () => {
    const css = write('c.css', '.a { color: #123456; }')
    const theme = write('theme.css', '@theme { --color-brand: #123456; }')
    const { out } = capture()
    await main([css, '--theme', theme])
    expect(out.join('')).toBe('.a { @apply text-brand; }\n')
  })

  it('reports a read error and sets a non-zero exit code', async () => {
    const { err } = capture()
    await main([`${tmp}-does-not-exist.css`])
    expect(err.join('')).toMatch(/tailward: .*ENOENT|no such file/)
    expect(process.exitCode).toBe(1)
  })

  it('errors when --watch is used without a file', async () => {
    const { err } = capture()
    await main(['--watch'])
    expect(err.join('')).toContain('--watch requires a file')
    expect(process.exitCode).toBe(1)
  })

  it('converts against a full --css theme via the engine', async () => {
    const input = write('engine.css', '.a { display: block; }')
    const themeFile = join(process.cwd(), `tmp-cli-engine-${process.pid}.css`)
    writeFileSync(themeFile, '@import "tailwindcss";')
    files.push(themeFile)
    const { out } = capture()
    await main([input, '--css', themeFile])
    expect(out.join('')).toBe('.a { @apply block; }\n')
  })

  it('prints help without converting', async () => {
    const { out } = capture()
    await main(['--help'])
    expect(out.join('')).toContain('Usage:')
  })

  it('reports a bad option and sets a non-zero exit code', async () => {
    const { err } = capture()
    await main(['--nope'])
    expect(err.join('')).toContain('unknown option')
    expect(process.exitCode).toBe(1)
  })
})
