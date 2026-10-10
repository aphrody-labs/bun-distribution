// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  artifactManifest,
  buildCommand,
  declarationCommand,
  prerequisiteCommands,
  smokeCommand,
  verifyArtifactProvenance,
  releasePlan,
  type ReleaseConfig,
} from "./publish-app-ui";
test("clean builds prepare identity through its canonical owner, without setup hooks", () => {
  expect(prerequisiteCommands()).toEqual([
    ["bun", "run", "--cwd", "crates/tauri/aphrody-tauri-api", "build"],
    ["bun", "run", "--cwd", "crates/tauri/aphrody-tauri-plugin-dialog", "build"],
    ["bun", "m3/scripts/fonts-sync.ts", "--quiet"],
    ["bun", "m3/scripts/fonts-sync.ts", "--check", "--quiet"],
    ["bun", "run", "--cwd", "m3/packages/identity", "sprite"],
  ]);
  expect(prerequisiteCommands().flat()).not.toContain("install");
});
const nativeShell =
  process.platform === "win32"
    ? join(process.env.ProgramFiles ?? "C:/Program Files", "Git/bin/bash.exe")
    : Bun.which("sh");
test.skipIf(!nativeShell || !existsSync(nativeShell))(
  "native shell writes valid JSON with a real trailing newline",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "app-ui-declaration-test-"));
    try {
      const process = Bun.spawn([nativeShell!, "-c", declarationCommand("deployment.json")], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await process.exited).toBe(0);
      const bytes = readFileSync(join(root, "deployment.json"), "utf8");
      expect(bytes).toBe('{"schemaVersion":1,"root":"current"}\n');
      expect(JSON.parse(bytes)).toEqual({ schemaVersion: 1, root: "current" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
test("remote declaration emits one printf escape and health checks precede trap dismissal", () => {
  const command = declarationCommand("/home/ubuntu/apps/downloads/app-ui/deployment.json.pending");
  expect(command).toContain("printf '%s" + String.fromCharCode(92) + "n'");
  expect(command).not.toContain("%s" + String.fromCharCode(92, 92) + "n");
  expect(command).toContain('{"schemaVersion":1,"root":"current"}');
  const smoke = smokeCommand("/home/ubuntu/apps/downloads/app-ui/backups/test");
  expect(smoke).toContain("--retry-max-time 15");
  expect(smoke).toContain("127.0.0.1:8797/health");
  expect(smoke).toContain("127.0.0.1:8797/os");
  expect(smoke).toContain('name="aphrody-rpc" content="unavailable"');
  expect(smoke).not.toContain("Cookie");
});
const revision = "a".repeat(40);
const config: ReleaseConfig = {
  host: { target: "dbfr", root: "/home/ubuntu/apps/downloads" },
  site: { appUi: { directory: "app-ui", declaration: "app-ui/deployment.json", nativeRpc: false } },
};
test("public assets flag reaches the real owner build and binds artifact provenance", () => {
  expect(buildCommand("C:/artifact", true)).toEqual([
    "bun",
    "m3/packages/app-ui/build.ts",
    "--out",
    "C:/artifact",
    "--public-assets",
  ]);
  expect(buildCommand("C:/artifact")).not.toContain("--public-assets");
  const original = { revision, publicAssets: true, files: [{ path: "app.js", sha256: "abc" }] };
  expect(() => verifyArtifactProvenance(original, { ...original, publicAssets: false })).toThrow(
    "provenance",
  );
  expect(() =>
    verifyArtifactProvenance(original, {
      ...original,
      files: [{ path: "app.js", sha256: "changed" }],
    }),
  ).toThrow("checksum");
  verifyArtifactProvenance(original, original);
});
test("dry-run plan stays in the declared downloads service and refuses proxy/host drift", () => {
  const plan = releasePlan(config, revision);
  expect(plan.release).toBe("/home/ubuntu/apps/downloads/app-ui/releases/app-ui-" + revision);
  expect(plan.restart).toContain("--no-deps --force-recreate downloads");
  expect(plan.nativeRpc).toBe(false);
  expect(() => releasePlan(config, "main")).toThrow("exact");
  expect(() => releasePlan({ ...config, host: { ...config.host, root: "/" } }, revision)).toThrow(
    "catalog",
  );
  expect(() =>
    releasePlan(
      { ...config, site: { appUi: { ...config.site.appUi, nativeRpc: true } } },
      revision,
    ),
  ).toThrow("isolation");
});
test("manifest verifies completeness and records changed bytes with exact source provenance", () => {
  const root = mkdtempSync(join(tmpdir(), "app-ui-manifest-test-"));
  try {
    expect(() => artifactManifest(root, revision)).toThrow("Incomplete");
    for (const name of ["index.html", "public-home.html", "app.js", "app.css", "public-docs.json"])
      writeFileSync(join(root, name), name);
    mkdirSync(join(root, "fonts"));
    writeFileSync(join(root, "fonts/font.woff2"), "font");
    const before = artifactManifest(root, revision);
    expect(before.revision).toBe(revision);
    expect(before.files).toHaveLength(6);
    expect(() => artifactManifest(root, revision, true)).toThrow("public assets declaration");
    writeFileSync(join(root, "public-assets.json"), '{"schemaVersion":1}');
    expect(artifactManifest(root, revision, true).publicAssets).toBe(true);
    writeFileSync(join(root, "app.js"), "changed");
    expect(
      artifactManifest(root, revision).files.find((file) => file.path === "app.js")?.sha256,
    ).not.toBe(before.files.find((file) => file.path === "app.js")?.sha256);
    symlinkSync(root, join(root, "escape"), "junction");
    expect(() => artifactManifest(root, revision)).toThrow("unsafe");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
