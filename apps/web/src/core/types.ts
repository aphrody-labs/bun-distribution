// SPDX-License-Identifier: Apache-2.0
/**
 * Types shared by the browser UI and the Bun server of apps/web.
 */

export interface SystemMetrics {
  bunVersion: string;
  uptimeSeconds: number;
  /** JS heap in use by the Bun server process (process.memoryUsage().heapUsed), in MB. */
  memoryUsageMb: number;
  timestampNs: bigint | string;
  platform: string;
  arch: string;
  cpus: number;
  targetEnvironment: 'web' | 'tauri' | 'native';
}

export interface BunApiEntry {
  id: string;
  name: string;
  category: 'runtime' | 'web-standards' | 'io' | 'crypto' | 'streams' | 'ffi' | 'bundler';
  signature: string;
  description: string;
  example: string;
  isWebStandard: boolean;
}

export interface MonorepoPackageInfo {
  name: string;
  version: string;
  description: string;
  /** Directory relative to the monorepo root. */
  dir: string;
  /** TypeScript files counted under the package (node_modules and dist excluded). */
  sourceFiles: number;
}

export interface CodebaseAnalysis {
  scannedAt: string;
  /** Exported type aliases found in the scanned workspace TypeScript files. */
  totalTypes: number;
  /** Exported interfaces found in the scanned workspace TypeScript files. */
  totalInterfaces: number;
  /** Exported functions found in the scanned workspace TypeScript files. */
  totalFunctions: number;
  totalPackages: number;
  bunApis: BunApiEntry[];
  packages: MonorepoPackageInfo[];
}
