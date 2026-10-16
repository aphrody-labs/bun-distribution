// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoveryCompose } from "./shenron-compute-recovery";

test("only compute and E5 restore, without adopting or recreating existing application services", async () => {
  const root = mkdtempSync(join(tmpdir(), "shenron-compute-plan-"));
  try {
    const envFile = join(root, "compute.env");
    await Bun.write(envFile, "APHRODY_SHENRON_PRODUCTION_READY=1\n");
    const manifest = join(root, "compose.json");
    await Bun.write(
      manifest,
      JSON.stringify(
        recoveryCompose({
          image: "aphrody:toolbox-012345abcdef",
          root,
          home: root,
          envFile,
          apply: false,
        }),
      ),
    );
    const result = Bun.spawnSync(
      ["docker", "compose", "-f", manifest, "config", "--format", "json"],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode).toBe(0);
    const config = JSON.parse(result.stdout.toString());
    expect(Object.keys(config.services).toSorted()).toEqual([
      "shenron-compute",
      "shenron-embed",
    ]);
    for (const service of Object.values(config.services) as Record<
      string,
      unknown
    >[]) {
      expect(service.network_mode).toBe("host");
      expect(service.user).toBe("1000:1000");
      expect(service.read_only).toBe(true);
      expect(service.privileged).not.toBe(true);
      expect(service.ports).toBeUndefined();
    }
    expect(config.services["shenron-compute"].command).toContain(
      "127.0.0.1:8789",
    );
    expect(config.services["shenron-embed"].volumes[0].read_only).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mutable or foreign image references and relative bind roots are refused", () => {
  const options = {
    image: "aphrody:toolbox-012345abcdef",
    root: "/tmp/recovery",
    home: "/tmp/home",
    envFile: "/etc/private.env",
    apply: false,
  };
  for (const image of [
    "aphrody:toolbox",
    "ubuntu:latest",
    "aphrody:toolbox-abc",
  ]) {
    expect(() => recoveryCompose({ ...options, image })).toThrow("immutable");
  }
  expect(() => recoveryCompose({ ...options, home: "relative" })).toThrow(
    "Absolute",
  );
});
