// SPDX-License-Identifier: Apache-2.0
import { openWebOs, type WebOs } from "@aphrody/webos-wasm";

export interface Catalog {
  generated: string;
  counts: { apps: number; packages: number; crates: number };
  apps: { id: string; d: string; k?: string }[];
  packages: { id: string; d: string }[];
  crates: { id: string; d: string }[];
  hosts: Record<string, { name: string; host: string; alias: string }>;
}

let osPromise: Promise<WebOs> | undefined;
/** One Rust file system (OPFS) shared by the explorer, the terminal and the engine. */
export function webos(): Promise<WebOs> {
  osPromise ??= openWebOs({ wasm: fetch("/wasm/aphrody_webos_wasm_bg.wasm") })
    .then(async os => {
      await seed(os);
      return os;
    })
    .catch(error => {
      osPromise = undefined;
      throw error;
    });
  return osPromise;
}

let catalogPromise: Promise<Catalog> | undefined;
export function catalog(): Promise<Catalog> {
  catalogPromise ??= fetch("/catalog.json").then(r => r.json() as Promise<Catalog>);
  return catalogPromise;
}

export const HOME = "/home/user";

const WELCOME = `# Welcome to Bun OS

Your files live in this browser (OPFS), on a Rust file system compiled to WebAssembly.
Open Terminal and try: ls, cat README.md, echo hi > note.txt.
`;

/** First run: create the home directory and a few starter files. Existing data is never touched. */
async function seed(os: WebOs) {
  try {
    os.fs.list(HOME);
    return;
  } catch {
    // Missing home: fall through to create it.
  }
  const enc = new TextEncoder();
  os.fs.mkdir(HOME);
  os.fs.write(`${HOME}/README.md`, enc.encode(WELCOME));
  os.fs.write(`${HOME}/hello.js`, enc.encode('console.log("hello from Bun OS");\n'));
  os.fs.mkdir(`${HOME}/Documents`);
  os.fs.mkdir(`${HOME}/Projects`);
  await os.flush();
}
