import { defineConfig } from 'vitest/config'

// The tests that need a DOM (hooks) say so with `// @vitest-environment jsdom`; the rest run in Node, where the client
// talks to the real API of the repository over HTTP.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    maxWorkers: 2,
  },
})
