// SPDX-License-Identifier: Apache-2.0
// Ambient declarations for assets and bundler-specific import.meta members used by the Artcraft packages.
declare module "*.png" {
  const url: string;
  export default url;
}
declare module "*.svg" {
  const url: string;
  export default url;
}
declare module "*.webp" {
  const url: string;
  export default url;
}
declare module "*.jpg" {
  const url: string;
  export default url;
}
declare module "*.css";
declare module "*?worker&inline" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}

interface ImportMeta {
  glob<T = string>(
    pattern: string | string[],
    options: { query?: string; import?: string; eager: true },
  ): Record<string, T>;
  glob<T = unknown>(
    pattern: string | string[],
    options?: { query?: string; import?: string; eager?: false },
  ): Record<string, () => Promise<T>>;
}
