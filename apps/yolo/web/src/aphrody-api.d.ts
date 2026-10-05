// Typing shim for the forked @aphrody/api (vendor/tauri/packages/api).
// The real sources are bundled through apps/web/tsconfig.json `paths`.
declare module "@aphrody/api/core" {
  export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}
