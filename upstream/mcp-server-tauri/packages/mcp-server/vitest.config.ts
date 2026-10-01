import { defineConfig } from 'vitest/config';

export default defineConfig({
   test: {
      globals: true,
      environment: 'node',
      testTimeout: 10000, // 10s for individual tests
      hookTimeout: 5000, // 5s for hooks
      include: [ 'tests/**/*.test.ts' ],
      maxConcurrency: 1, // Run tests sequentially to avoid port conflicts
      fileParallelism: false, // Disable file-level parallelism
      pool: 'forks', // Use separate processes for isolation
      globalSetup: './vitest.global-setup.ts', // Start app once globally
   },
});
