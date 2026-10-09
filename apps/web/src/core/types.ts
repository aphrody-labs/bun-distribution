/**
 * Core types shared across Web, Tauri Desktop, and React Native targets.
 */

export interface SystemMetrics {
  bunVersion: string;
  uptimeSeconds: number;
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
  nativeCMethod?: string;
  isWebStandard: boolean;
}

export interface MonorepoPackageInfo {
  name: string;
  version: string;
  description: string;
  dir: string;
  speedup: string;
  webFeatures: string[];
}

export interface M3Palette {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  surface: string;
  onSurface: string;
  surfaceVariant: string;
  onSurfaceVariant: string;
  background: string;
  onBackground: string;
  outline: string;
  outlineVariant: string;
  error: string;
  onError: string;
}

export interface CodebaseAnalysis {
  scannedAt: string;
  totalTypes: number;
  totalInterfaces: number;
  totalFunctions: number;
  totalPackages: number;
  bunApis: BunApiEntry[];
  packages: MonorepoPackageInfo[];
}
