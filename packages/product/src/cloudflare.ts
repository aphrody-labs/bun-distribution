// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutRoot, findWorkspaceRoot } from "@aphrody/paths";
import { wrangler } from "@aphrody/bun-cloudflare/wrangler";

/** Build through the existing runtime site owner, then deploy the existing Worker. */
export async function main(args: string[]): Promise<number> {
  const bun = checkoutRoot("bun");
  const cwd = join(bun, "packages/web/cloudflare");
  if (!(await Bun.file(join(cwd, "wrangler.jsonc")).exists()))
    throw new Error("Canonical Cloudflare worker configuration is missing");
  if (
    args[0] !== "deploy" ||
    args.includes("--help") ||
    args.includes("--assets")
  )
    return wrangler(args.length ? args : ["--help"], { cwd }).exited;

  const stage = await mkdtemp(join(tmpdir(), "aphrody-cloudflare-"));
  const data = join(stage, "site-data.json");
  const assets = join(stage, "assets");
  const offline = args.includes("--dry-run") ? ["--offline"] : [];
  const run = async (script: string, options: string[]) => {
    const child = Bun.spawn(
      [process.execPath, join(bun, "packages/web/site", script), ...options],
      {
        cwd: findWorkspaceRoot(),
        stdout: "inherit",
        stderr: "inherit",
        windowsHide: true,
        timeout: 120_000,
      },
    );
    if ((await child.exited) !== 0)
      throw new Error(`Cloudflare asset preparation failed: ${script}`);
  };
  try {
    await run("collect.ts", [
      "--runtime",
      bun,
      "--distribution",
      findWorkspaceRoot(),
      "--out",
      data,
      ...offline,
    ]);
    await run("build.ts", [
      "--src",
      bun,
      "--out",
      assets,
      "--data",
      data,
      ...offline,
    ]);
    return await wrangler([...args, "--assets", assets], { cwd }).exited;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
