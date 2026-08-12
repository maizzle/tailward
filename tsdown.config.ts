import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/**/*.ts', '!src/**/*.test.ts', '!src/tests/**'],
  format: 'esm',
  dts: true,
  unbundle: true,
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  outDir: 'dist',
  clean: true,
})
