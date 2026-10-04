// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileDiscordApp, startDiscordApp } from "../src/apps";

test("a compiled Bun application runs and stops under the installed Yolo supervisor", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aphrody-discord-app-"));
  try {
    const entrypoint = join(directory, "app.ts");
    await Bun.write(
      entrypoint,
      `
      console.log(JSON.stringify({ profile: process.env.APHRODY_PROFILE, workspace: process.env.APHRODY_WORKSPACE ?? null }));
      if (process.argv.includes("--hold")) {
        process.on("SIGTERM", () => { console.log("stopped"); process.exit(0); });
        setInterval(() => {}, 1000);
      }
    `,
    );
    const binary = await compileDiscordApp({
      entrypoint,
      outfile: join(directory, "discord-fixture"),
    });
    using oneShot = await startDiscordApp({
      binary,
      profile: "dbfr",
      env: { APHRODY_WORKSPACE: "/forbidden-parent-profile" },
      stdio: "capture-lossless",
    });
    const output = await oneShot.collectOutput({ timeoutMs: 5000 });
    expect(output.status.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(output.stdout))).toEqual({
      profile: "dbfr",
      workspace: null,
    });
    using held = await startDiscordApp({ binary, profile: "dbfr", args: ["--hold"] });
    let ready = "";
    const deadline = Date.now() + 5000;
    while (!ready.includes("dbfr") && Date.now() < deadline) {
      ready += held.takeStdout();
      // oxlint-disable-next-line no-await-in-loop -- wait for the owned process to emit readiness
      await Bun.sleep(10);
    }
    expect(ready).toContain("dbfr");
    expect(held.status().running).toBe(true);
    const stopped = await held.stopAsync(1000);
    expect(stopped.running).toBe(false);
    expect(stopped.exitCode).toBe(0);
    expect(held.takeStdout()).toContain("stopped");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test("the process owner rejects an ambiguous domain before starting anything", async () => {
  await expect(startDiscordApp({ binary: "missing", profile: "../aphrody" })).rejects.toThrow(
    "explicit named",
  );
});
