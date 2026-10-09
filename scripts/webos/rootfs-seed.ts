#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Writes the first-boot seed of the WebOS filesystem (Aphrody Alpine 3.24
 * layout, wasm32 apk repository, module registry). The files worker applies it
 * once to an empty OPFS image. No wasm is built here.
 *
 * Usage: bun scripts/webos/rootfs-seed.ts [--out var/runs/webos/rootfs-seed.json]
 */
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

const ALPINE = "3.24";
const APK_ARCH = "wasm32";
const REPO = `https://github.com/aphrody-labs/aports/releases/download/aphrody-${ALPINE}-${APK_ARCH}`;

export const MODULES = [
  {
    name: "aphrody-webos-wasm",
    kind: "wasm-bindgen",
    path: "/dist/wasm/webos/aphrody_webos_wasm.js",
    apps: ["files"],
  },
  {
    name: "aphrody-command-wasm",
    kind: "wasm-bindgen",
    path: "/dist/wasm/cli/aphrody_command_wasm.js",
    apps: ["aphrody-tools"],
  },
  {
    name: "bun_wasm",
    kind: "wasi-reactor",
    path: "/dist/wasm/bun/bun_wasm.wasm",
    apps: ["bun-repl"],
  },
];

export function rootfsSeed(): Record<string, string | null> {
  return {
    "/bin": null,
    "/etc": null,
    "/etc/alpine-release": `${ALPINE}.0\n`,
    "/etc/os-release": [
      'NAME="Aphrody Alpine Linux"',
      "ID=alpine",
      "ID_LIKE=aphrody",
      `VERSION_ID=${ALPINE}.0`,
      `PRETTY_NAME="Aphrody Alpine ${ALPINE} (WebOS, ${APK_ARCH})"`,
      'HOME_URL="https://github.com/aphrody-labs/aports"',
      "",
    ].join("\n"),
    "/etc/hostname": "aphrody-webos\n",
    "/etc/apk/arch": `${APK_ARCH}\n`,
    "/etc/apk/repositories": `${REPO}\n`,
    "/etc/apk/world": "",
    "/home": null,
    "/home/aphrody": null,
    "/home/aphrody/README.md":
      "# Aphrody WebOS\n\nFichiers, Processus, Bun REPL et Outils Aphrody tournent en WebAssembly dans ce navigateur.\nLe système de fichiers est persisté dans OPFS.\n",
    "/tmp": null,
    "/usr/share/aphrody/modules.json": `${JSON.stringify(MODULES, null, 2)}\n`,
    "/var/cache/apk": null,
  };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  const out = resolve(
    values.out ?? resolve(import.meta.dir, "../../var/runs/webos/rootfs-seed.json"),
  );
  await mkdir(dirname(out), { recursive: true });
  await Bun.write(out, `${JSON.stringify(rootfsSeed(), null, 2)}\n`);
  console.log(out);
}
