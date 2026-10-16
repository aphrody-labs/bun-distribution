// SPDX-License-Identifier: Apache-2.0
// Tauri 3 desktop app. `@aphrody/web-to-tauri` probes the app directory and plans a sidecar conversion: the
// executable of `m3-bun compile` runs next to the app on loopback and serves the UI and the API, the
// `aphrody-tauri-wrap` runtime plugin starts it, waits for /healthz and loads it. `generateProject` writes the
// project through the Tauri shell and the pins of `@aphrody/scaffold`; it runs in a scratch directory and the
// files come back as the target's output. Nothing is compiled: `bun run build:sidecar` then `bun run build`
// in the generated directory do that.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { GENERATED_NOTE } from "../util.ts";
import { appFromTarget } from "./lambda.ts";
import type { Target, TargetContext, TargetFile } from "./types.ts";

const BINARY = /\.(?:png|ico|icns|webp)$/;

/** `scripts/build-sidecar.ts` of the project: `m3-bun compile` into `src-tauri/binaries/server-<host triple>`. */
export const sidecarScript = (c: TargetContext): string => `// ${GENERATED_NOTE}
// Compiles ${c.name} (UI and API in one executable) into the sidecar Tauri bundles (\`bundle.externalBin\`).
import { resolve } from "node:path";

const app = process.env.SIDECAR_SOURCE ?? resolve(import.meta.dir, "..", ${JSON.stringify(appFromTarget(c))});
const host = /host: (\\S+)/.exec(Bun.spawnSync(["rustc", "-vV"], { windowsHide: true }).stdout.toString())?.[1];
if (!host) throw new Error("rustc -vV did not report a host triple");
const outfile = resolve("src-tauri/binaries", \`server-\${host}\${host.includes("windows") ? ".exe" : ""}\`);
const result = Bun.spawnSync([...${JSON.stringify(c.cli.split(" "))}, "compile", "--outfile", outfile], {
  windowsHide: true,
  cwd: app,
  stdio: ["inherit", "inherit", "inherit"],
});
process.exit(result.exitCode ?? 1);
`;

/** Rebase the relative crate path `generateProject` wrote for the scratch directory onto the target directory. */
function rebaseCrate(
  cargo: string,
  scratchTauri: string,
  finalTauri: string | undefined,
): string {
  return cargo.replace(
    /^(aphrody-tauri-wrap = \{ path = ")([^"]+)(")/m,
    (_, head: string, path: string, tail: string) => {
      const crate = resolve(scratchTauri, path);
      const next = finalTauri ? relative(finalTauri, crate) : crate;
      return `${head}${next.replaceAll("\\", "/")}${tail}`;
    },
  );
}

async function generateTauri(c: TargetContext): Promise<TargetFile[]> {
  if (!c.appDir)
    throw new Error(
      "m3-bun: the tauri target reads the app directory (contextFor sets appDir)",
    );
  let w2t: typeof import("@aphrody/web-to-tauri");
  let names: typeof import("@aphrody/scaffold/names");
  try {
    [w2t, names] = await Promise.all([
      import("@aphrody/web-to-tauri"),
      import("@aphrody/scaffold/names"),
    ]);
  } catch (error) {
    throw new Error(
      `m3-bun: the tauri target needs @aphrody/web-to-tauri and @aphrody/scaffold (${(error as Error).message})`,
      { cause: error },
    );
  }
  const probe = await w2t.probeDirectory(c.appDir);
  // The server entry of an m3 app is its config: `m3-bun compile` turns it into the sidecar executable.
  const plan = w2t.planConversion(
    { ...probe, serverEntry: probe.serverEntry ?? "m3.config.ts" },
    {
      mode: "sidecar",
      name: c.windows?.title ?? c.name,
      identifier: names.tauriIdentifier(c.name),
      port: c.port,
    },
  );
  if (plan.config.sidecar)
    plan.config.sidecar = { ...plan.config.sidecar, readyPath: "/healthz" };

  const scratch = await mkdtemp(join(tmpdir(), "m3-bun-tauri-"));
  try {
    const offline: typeof fetch = Object.assign(
      () =>
        Promise.reject(new Error("m3-bun: the tauri target does not fetch")),
      { preconnect: () => {} },
    );
    const result = await w2t.generateProject(plan, scratch, {
      copyLock: false,
      fetch: offline,
    });
    const files: TargetFile[] = [];
    for (const file of result.files) {
      const path = relative(scratch, file).replaceAll("\\", "/");
      const blob = Bun.file(file);
      // oxlint-disable-next-line no-await-in-loop -- Read back a bounded set of generated files in order.
      let content: string | Uint8Array = BINARY.test(path)
        ? await blob.bytes()
        : await blob.text();
      if (path === "src-tauri/Cargo.toml")
        content = rebaseCrate(
          content as string,
          join(scratch, "src-tauri"),
          c.targetDir && join(c.targetDir, "src-tauri"),
        );
      if (path === "scripts/build-sidecar.ts") content = sidecarScript(c);
      if (path === "src-tauri/tauri.conf.json" || path === "package.json")
        content = `${JSON.stringify({ ...JSON.parse(content as string), version: c.version }, null, 2)}\n`;
      files.push({ path, content });
    }
    return files;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export const tauri: Target = {
  id: "tauri",
  title: "Tauri",
  description:
    "Tauri 3 project from @aphrody/web-to-tauri (sidecar plan) and the @aphrody/scaffold shell: the compiled app runs as the sidecar",
  generate: generateTauri,
};
