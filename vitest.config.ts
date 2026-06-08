// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    mockReset: true,
    clearMocks: true,
    restoreMocks: true,
    fileParallelism: false
  },
})