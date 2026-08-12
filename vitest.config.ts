import { defineConfig, coverageConfigDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      exclude: [...coverageConfigDefaults.exclude, 'src/tests/**'],
    },
  },
})
