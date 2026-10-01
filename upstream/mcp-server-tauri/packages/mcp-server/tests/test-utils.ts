/**
 * Test utilities for E2E tests.
 */

import { readFileSync, existsSync } from 'fs';
import path from 'path';

const TEST_APP_PORT_FILE = path.resolve(process.cwd(), '.test-app-port');

let cachedPort: number | null = null;

/**
 * Gets the port that the test app is running on.
 * This is set by the global test setup after starting the Tauri app.
 *
 * @returns The port number the test app is listening on
 * @throws Error if the test app port is not available
 */
export function getTestAppPort(): number {
   // Return cached port if available
   if (cachedPort !== null) {
      return cachedPort;
   }

   // Read from file (written by global setup)
   if (existsSync(TEST_APP_PORT_FILE)) {
      const portStr = readFileSync(TEST_APP_PORT_FILE, 'utf-8').trim();

      cachedPort = parseInt(portStr, 10);

      if (!isNaN(cachedPort)) {
         return cachedPort;
      }
   }

   throw new Error(
      'Test app port not available. Make sure the global test setup has started the Tauri app.'
   );
}

/**
 * Checks if the test app has been started by the global setup.
 */
export function isTestAppStarted(): boolean {
   return existsSync(TEST_APP_PORT_FILE);
}
