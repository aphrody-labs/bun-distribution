// SPDX-License-Identifier: Apache-2.0
/**
 * Tauri 3 line written into every generated project. Mirror of the root workspace pins:
 * `tauri-sync` (`config/tauri-upstream.json` `mirrors`) fails on drift and rewrites this literal on
 * `--apply`. This is the only copy; m3-next-migrate and web-to-tauri re-export it.
 */
export const TAURI_3 = {
  tauri: "3.0.0-alpha.4",
  runtimeWry: "3.0.0-alpha.4",
  build: "3.0.0-alpha.3",
  pluginOpener: "3.0.0-alpha.2",
  jsApi: "3.0.0-alpha.2",
  jsPluginOpener: "3.0.0-alpha.1",
  jsCli: "3.0.0-alpha.4",
} as const;

/** `tauri-runtime-cef` is pinned by Koharu only; generated CEF projects use the same line. */
export const TAURI_CEF = "3.0.0-alpha.4";

/** JSON schema URL of `tauri.conf.json`, tagged with the pinned Tauri release. */
export function tauriSchemaUrl(version: string = TAURI_3.tauri): string {
  return `https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v${version}/crates/tauri-schema-generator/schemas/config.schema.json`;
}
