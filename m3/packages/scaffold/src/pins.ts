// SPDX-License-Identifier: Apache-2.0
/**
 * Tauri 3 line written into every generated project: the Aphrody forks (`aphrody-tauri*` crates, `@aphrody/*`
 * packages) released with the monorepo, and the upstream CLI. Mirror of the root workspace pins:
 * `tauri-sync` (`tools/config/tauri-upstream.json` `mirrors`) fails on drift and rewrites this literal on
 * `--apply`. This is the only copy; m3-next-migrate and web-to-tauri re-export it.
 */
export const TAURI_3 = {
  tauri: "1.4.4",
  runtimeCef: "1.4.4",
  build: "1.4.4",
  pluginOpener: "1.4.4",
  jsApi: "1.4.4",
  jsPluginOpener: "1.4.4",
  /** Upstream Tauri release the forks are based on; tags the config schema. */
  upstream: "3.0.0-alpha.4",
  jsCli: "3.0.0-alpha.4",
} as const;

/** JSON schema URL of `tauri.conf.json`, tagged with the upstream Tauri release of the forks. */
export function tauriSchemaUrl(version: string = TAURI_3.upstream): string {
  return `https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v${version}/crates/tauri-schema-generator/schemas/config.schema.json`;
}
