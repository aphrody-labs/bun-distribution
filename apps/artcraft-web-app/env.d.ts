/// <reference types="@remix-run/node" />
// Environment and asset shapes implemented by the canonical Bun frontend builder.
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
  readonly BASE_URL: string;
  readonly VITE_ENVIRONMENT_TYPE: string;
  readonly VITE_POSTHOG_API_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
  glob(pattern: string, options: { query: "?raw"; import: "default"; eager: true }): Record<string, string>;
}
declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}
declare module "*.css" {}
declare module "*?worker&inline" {
  const factory: new (options?: WorkerOptions) => Worker;
  export default factory;
}
declare module "*?raw" {
  const contents: string;
  export default contents;
}
declare module "*?url" {
  const url: string;
  export default url;
}
declare module "*.svg" {
  const url: string;
  export default url;
}
declare module "*.png" {
  const url: string;
  export default url;
}
declare module "*.jpg" {
  const url: string;
  export default url;
}
declare module "*.jpeg" {
  const url: string;
  export default url;
}
declare module "*.webp" {
  const url: string;
  export default url;
}
declare module "*.mp3" {
  const url: string;
  export default url;
}
declare module "*.mp4" {
  const url: string;
  export default url;
}
