// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { activateR2, installedR2Matches, r2Plan, R2_DIST, stageR2, stepNativeRuntime } from "../../src/setup/r2.ts";
import { samplePack, testContext } from "../admin/helpers.ts";

const hash = "a".repeat(64);
function fetcher(change: Record<string, unknown> = {}, sums = `${hash}  bun-windows-x64.zip`) {
  return async (url: string) =>
    new Response(
      url.endsWith("SHA256SUMS.txt")
        ? sums
        : JSON.stringify({
            product: "bun",
            version: "1.4.3-test",
            platform: "windows-x64",
            archive: "bun-windows-x64.zip",
            sha256: hash,
            binary: "bun-windows-x64/bun.exe",
            aliases: ["bun", "bunx"],
            ...change,
          }),
    );
}
test("R2 plans bind archive identity and checksums and expose bunx native alias", async () => {
  const plan = await r2Plan("bun", fetcher());
  expect(plan.url).toBe(`${R2_DIST}/bun/bun-windows-x64.zip`);
  expect(plan.aliases["bunx.exe"]).toBe("bun.exe");
  const versioned = await r2Plan("bun", fetcher({ path: "aphrody-v1.4.4" }));
  expect(versioned.url).toBe(`${R2_DIST}/bun/aphrody-v1.4.4/bun-windows-x64.zip`);
  await expect(r2Plan("bun", fetcher({ path: "../escape" }))).rejects.toThrow("path");
  for (const change of [
    { product: "other" },
    { platform: "linux-x64" },
    { archive: "../escape.zip" },
    { binary: "C:/Windows/bun.exe" },
    { aliases: ["bun", "../bunx"] },
    { aliases: ["bun"] },
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await expect(r2Plan("bun", fetcher(change))).rejects.toThrow();
  }
  await expect(r2Plan("bun", fetcher({}, `${"b".repeat(64)}  bun-windows-x64.zip`))).rejects.toThrow("mismatch");
  await expect(
    r2Plan("bun", fetcher({}, `${hash}  bun-windows-x64.zip\n${hash}  bun-windows-x64.zip`)),
  ).rejects.toThrow("mismatch");
});
test("R2 corrupt archive never extracts or executes binaries", async () => {
  const { ctx, sys } = testContext();
  const plan = await r2Plan("bun", fetcher());
  ctx.fetchImpl = async () => new Response("corrupt");
  await expect(stageR2(ctx, plan, ctx.paths.installDir)).rejects.toThrow("SHA-256");
  expect(sys.calls).toHaveLength(0);
});

test("setup defaults to R2 and preserves explicit legacy download endpoint", async () => {
  const requests: string[] = [];
  const { ctx } = testContext({
    fetchImpl: async url => {
      requests.push(url);
      if (url.includes("/aphrody/"))
        return new Response(
          url.endsWith("SHA256SUMS.txt")
            ? `${hash}  aphrody-windows-x64.zip`
            : JSON.stringify({
                product: "aphrody",
                version: "1.0.0",
                platform: "windows-x64",
                archive: "aphrody-windows-x64.zip",
                sha256: hash,
                binaries: ["aphrody-windows-x64/aphrody.exe", "aphrody-windows-x64/aphrody-site.exe"],
                aliases: ["aphrody"],
              }),
        );
      return fetcher()(url);
    },
  });
  const result = await stepNativeRuntime.run(ctx, "simuler", {
    repoReady: false,
  });
  expect(result.state).toBe("a-faire");
  expect(requests.every(url => url.startsWith(R2_DIST))).toBe(true);
  requests.length = 0;
  await stepNativeRuntime.run(ctx, "simuler", {
    repoReady: false,
    pack: samplePack({ downloadsBase: "https://legacy.example.test" }),
  });
  expect(requests[0]).toBe("https://legacy.example.test/latest.json");
});

test("activation builds native bunx alias and retains previous managed bin", async () => {
  const { ctx, root, sys } = testContext();
  sys.handlers.push({ match: "powershell.exe", result: { code: 0 } });
  const plan = await r2Plan("bun", fetcher());
  const staged = join(root, "stage");
  mkdirSync(staged);
  writeFileSync(join(staged, "bun.exe"), "verified-executable-fixture");
  const install = join(root, "install");
  mkdirSync(join(install, "bin"), { recursive: true });
  writeFileSync(join(install, "bin", "old.txt"), "preserved");
  const bin = await activateR2(ctx, [{ plan, dir: staged }], install);
  expect(readFileSync(join(bin, "bunx.exe"), "utf8")).toBe("verified-executable-fixture");
  expect(readFileSync(join(bin, "r2-install.json"), "utf8")).toContain(hash);
  expect(await installedR2Matches(install, [plan])).toBe(true);
  writeFileSync(join(bin, "bunx.exe"), "corrupt alias");
  expect(await installedR2Matches(install, [plan])).toBe(false);
  expect(
    sys.calls.filter(call => call.argv[0]?.endsWith("bun.exe") || call.argv[0]?.endsWith("bunx.exe")),
  ).toHaveLength(0);
});
