// SPDX-License-Identifier: Apache-2.0
/**
 * Tauri 3 line written into every generated project. Mirror of the root workspace pins:
 * `tauri-sync` (`tools/config/tauri-upstream.json` `mirrors`) fails on drift and rewrites this literal on
 * `--apply`. This is the only copy; m3-next-migrate and web-to-tauri re-export it.
 */
export const TAURI_3 = {
  tauri: "3.0.0-alpha.4",
  runtimeCef: "3.0.0-alpha.5",
  build: "3.0.0-alpha.3",
  pluginOpener: "3.0.0-alpha.2",
  jsApi: "3.0.0-alpha.3",
  jsPluginOpener: "3.0.0-alpha.3",
  jsCli: "3.0.0-alpha.4",
} as const;

/** JSON schema URL of `tauri.conf.json`, tagged with the pinned Tauri release. */
export function tauriSchemaUrl(version: string = TAURI_3.tauri): string {
  return `https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v${version}/crates/tauri-schema-generator/schemas/config.schema.json`;
}
