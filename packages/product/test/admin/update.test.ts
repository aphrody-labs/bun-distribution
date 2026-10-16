// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { currentPlatform } from "../../src/shared/update.ts";
import {
  KIT_ARTIFACT,
  omarApp,
  updateKit,
} from "../../src/admin/lib/update.ts";
import { testContext } from "./helpers.ts";

let server: ReturnType<typeof Bun.serve>;
let base = "";
let archive = new Uint8Array();
let sha = "";
let advertise = true;
let tamper = false;

beforeAll(() => {
  const src = mkdtempSync(join(tmpdir(), "omar-pack-"));
  writeFileSync(join(src, "Aphrody-Omar"), "NEW-EXE");
  writeFileSync(join(src, "Guide.html"), "new guide");
  const tar = join(src, "..", `omar-${Date.now()}.tar.gz`);
  Bun.spawnSync(
    [
      "tar",
      "-czf",
      basename(tar),
      "-C",
      basename(src),
      "Aphrody-Omar",
      "Guide.html",
    ],
    {
      windowsHide: true,
      cwd: dirname(src),
    },
  );
  archive = new Uint8Array(readFileSync(tar));
  sha = createHash("sha256").update(archive).digest("hex");
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      const file = "omar-kit-0.2.0-x86_64-pc-windows-msvc.tar.gz";
      if (path === "/latest.json")
        return Response.json({
          schemaVersion: 1,
          release: { id: "r1" },
          baseUrl: base,
          artifacts: advertise
            ? [
                {
                  name: KIT_ARTIFACT,
                  version: "0.2.0",
                  platform: "windows-x86_64",
                  url: `${base}/files/${file}`,
                  sha256: sha,
                  size: archive.byteLength,
                  file,
                },
              ]
            : [],
        });
      if (path === "/releases/r1/SHA256SUMS")
        return new Response(`${tamper ? "0".repeat(64) : sha}  ${file}\n`);
      if (path === `/releases/r1/files/${file}`)
        return new Response(archive as unknown as BodyInit);
      return new Response("nope", { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

function installed() {
  const t = testContext({ platform: "win32" });
  const dir = join(t.root, "install");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "Aphrody-Omar"), "OLD-EXE");
  t.ctx.exePath = join(dir, "Aphrody-Omar");
  t.ctx.fetchImpl = fetch;
  writeFileSync(join(dir, "Guide.html"), "old guide");
  return { ...t, dir };
}

test("the kit updates itself from the downloads catalogue with the creator-kit engine", async () => {
  advertise = true;
  tamper = false;
  const { ctx, dir } = installed();
  const result = await updateKit(ctx, { checkOnly: true, base });
  expect(result).toMatchObject({ status: "available", latest: "0.2.0" });
  expect(readFileSync(join(dir, "Aphrody-Omar"), "utf8")).toBe("OLD-EXE");
  const done = await updateKit(ctx, { base });
  expect(done).toMatchObject({ status: "updated", latest: "0.2.0" });
  expect(readFileSync(join(dir, "Aphrody-Omar"), "utf8")).toBe("NEW-EXE");
  expect(readFileSync(join(dir, "Aphrody-Omar.old"), "utf8")).toBe("OLD-EXE");
  expect(readFileSync(join(dir, "Guide.html"), "utf8")).toBe("new guide");
});

test("up to date, nothing published and a catalogue that disagrees with SHA256SUMS", async () => {
  const { ctx, dir } = installed();
  ctx.version = "0.2.0";
  advertise = true;
  expect((await updateKit(ctx, { base })).status).toBe("up-to-date");
  advertise = false;
  expect(await updateKit(ctx, { base })).toMatchObject({ status: "skipped" });
  advertise = true;
  tamper = true;
  ctx.version = "0.1.0";
  await expect(updateKit(ctx, { base })).rejects.toThrow(
    "pas la même empreinte",
  );
  expect(readFileSync(join(dir, "Aphrody-Omar"), "utf8")).toBe("OLD-EXE");
  tamper = false;
});

test("a source run never replaces itself", async () => {
  const { ctx } = installed();
  ctx.exePath = "/usr/bin/bun";
  advertise = true;
  expect(await updateKit(ctx, { base })).toMatchObject({
    status: "skipped",
    detail: expect.stringContaining("sources"),
  });
});

test("all product roles use the same update folder and command", () => {
  expect(omarApp("1.2.3")).toEqual({
    name: "Aphrody/Setup",
    version: "1.2.3",
    disableEnv: "APHRODY_OMAR_NO_UPDATE",
    updateCommand: "mise-a-jour",
  });
  expect(currentPlatform()).toMatch(/-(x64|arm64)$/);
});
