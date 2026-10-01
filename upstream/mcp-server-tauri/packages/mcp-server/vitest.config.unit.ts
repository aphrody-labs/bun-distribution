import { defineConfig } from 'vitest/config';

export default defineConfig({
   test: {
      globals: true,
      environment: 'node',
      testTimeout: 10000,
      hookTimeout: 5000,
      include: [ 'tests/unit/**/*.test.ts' ],
      // No global setup - unit tests don't need the Tauri app
   },
});
