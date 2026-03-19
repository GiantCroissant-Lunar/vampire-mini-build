import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Scenario tests need long timeouts (gameplay sessions)
    testTimeout: 300_000,    // 5 min per test
    hookTimeout: 120_000,    // 2 min for setup/teardown

    // Reporter outputs for CI and artifact collection
    reporters: ['verbose', 'json'],
    outputFile: {
      json: './test-results.json',
    },

    // Run scenarios sequentially — they share one game instance
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },

    // File patterns
    include: ['scenarios/**/*.test.ts'],

    // No globalSetup — each scenario connects to bridge on its own.
    // Start bridge + game manually before running:
    //   1. node server.mjs        (bridge relay)
    //   2. Launch game             (exported build)
    //   3. npm test / npm run test:watch
    //
    // Or use: node verify.mjs --skip-export  (handles everything)
  },
})
