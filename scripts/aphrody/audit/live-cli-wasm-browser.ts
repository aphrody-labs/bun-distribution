#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/** Exercise the existing pure-command WASM in the native Aphrody Web browser. */
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const root = resolve(import.meta.dir, "../../../");
const wasm = Bun.file(resolve(root, "packages/infra/cli-wasm/wasm/aphrody_command_wasm_bg.wasm"));
if (!(await wasm.exists())) throw new Error("Build the capability-owner WASM package first");
const built = await Bun.build({
  entrypoints: [resolve(root, "packages/infra/cli-wasm/src/index.ts")],
  target: "browser",
  minify: true,
});
if (!built.success || built.outputs.length !== 1) throw new Error("Browser facade build failed");
const js = await built.outputs[0]!.text();
const page = `<!doctype html><html><head><title>Aphrody WASM qualification</title></head>
<body><pre id="result">WASM_PENDING</pre><script type="module">
import { loadCliWasm } from "./index.js";
const out = document.getElementById("result");
try {
  const response = await fetch("./aphrody_command_wasm_bg.wasm");
  if (!response.ok || response.headers.get("content-type") !== "application/wasm") throw Error("WASM HTTP/MIME");
  const cli = await loadCliWasm(response);
  const ops = cli.json(["rag", "ops"]);
  if (ops.abi !== 1) throw Error("RAG ABI");
  const repair = cli.json(["toolcall", "repair", "-"], {stdin:"{'a': 1,}"});
  if (repair.value.a !== 1 || !repair.repairs.length) throw Error("toolcall repair");
  const md = cli.text(["html", "markdown", "-"], {stdin:"<article><h1>Browser wasm</h1><p>Actual Rust command execution.</p></article>"});
  if (!md.includes("# Browser wasm")) throw Error("HTML markdown");
  if (cli.run(["nope"]).code !== 2) throw Error("usage status");
  out.textContent = "WASM_BROWSER_PASS " + JSON.stringify({version:cli.version,abi:ops.abi,repair:repair.value,markdown:md});
} catch (e) { out.textContent = "WASM_BROWSER_FAIL " + String(e); }
</script></body></html>`;

const args = Bun.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
};
const url = option("--url");
const out = option("--out");
const payloads = {
  "index.html": new TextEncoder().encode(page),
  "index.js": new TextEncoder().encode(js),
  "aphrody_command_wasm_bg.wasm": new Uint8Array(await wasm.arrayBuffer()),
};
const hashes = Object.fromEntries(
  Object.entries(payloads).map(([name, bytes]) => [name, new Bun.CryptoHasher("sha256").update(bytes).digest("hex")]),
);
if (out) {
  // Exclusive staging; never replace an existing qualification or release.
  await mkdir(resolve(out));
  await Promise.all(Object.entries(payloads).map(([name, bytes]) => Bun.write(resolve(out, name), bytes)));
  await Bun.write(
    resolve(out, "qualification.json"),
    JSON.stringify(
      {
        schema: "aphrody-cli-wasm-browser-qualification/v1",
        purpose: "public isolated browser qualification; not an official release or UI migration",
        moduleSourceProvenance: "unverified; bytes and tested behavior qualified separately",
        files: hashes,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ staged: resolve(out), files: hashes }, null, 2));
}
if (url) {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash)
    throw new Error("Use a credential-free public HTTPS qualification URL");
  if (target.hostname !== "os.aphrody.com" && !/^pub-[a-f0-9]+\.r2\.dev$/.test(target.hostname))
    throw new Error("Qualification must use the declared Aphrody OS or public R2 origin");
  await Promise.all(
    Object.entries(payloads).map(async ([name]) => {
      const response = await fetch(new URL(name, target));
      if (!response.ok) throw new Error(`Public qualification file ${name} returned ${response.status}`);
      const bytes = await response.arrayBuffer();
      if (new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== hashes[name])
        throw new Error(`Public qualification integrity mismatch: ${name}`);
      if (name.endsWith(".wasm") && response.headers.get("content-type") !== "application/wasm")
        throw new Error("Public WASM MIME is not application/wasm");
    }),
  );
  const proc = Bun.spawn(["aphrody", "web", "browser", "snapshot", target.href, "--json"], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Native Aphrody Web failed (${exitCode}): ${stderr}`);
  const snapshot = JSON.parse(stdout) as { url: string; snapshot: string };
  if (!snapshot.snapshot.includes("WASM_BROWSER_PASS") || snapshot.snapshot.includes("WASM_BROWSER_FAIL"))
    throw new Error(`Browser qualification incomplete: ${snapshot.snapshot}`);
  console.log(
    JSON.stringify(
      {
        browser: "aphrody web browser snapshot",
        scope: "public browser WASM qualification; not full OS frontend migration",
        wasmBytes: wasm.size,
        wasmSha256: new Bun.CryptoHasher("sha256").update(await wasm.arrayBuffer()).digest("hex"),
        snapshot: snapshot.snapshot,
      },
      null,
      2,
    ),
  );
}
if (!out && !url)
  throw new Error("Usage: live-cli-wasm-browser.ts --out <new-directory> | --url <public-qualification-url>");
