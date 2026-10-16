// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileDiscordApp, startDiscordApp } from "../src/apps";

test("compilation returns the actual runnable output path on the selected native host", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aphrody-discord-output-"));
  try {
    const entrypoint = join(directory, "app.ts");
    await Bun.write(
      entrypoint,
      "console.log(JSON.stringify({compiled:true}));",
    );
    const executable = await compileDiscordApp({
      entrypoint,
      outfile: join(directory, "app"),
    });
    expect(await Bun.file(executable).exists()).toBe(true);
    const process = Bun.spawn([executable], {
      windowsHide: true,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(process.stdout).text();
    expect(await process.exited).toBe(0);
    expect(JSON.parse(output)).toEqual({ compiled: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test("a compiled Bun application runs and stops under the installed Yolo supervisor", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aphrody-discord-app-"));
  try {
    const entrypoint = join(directory, "app.ts");
    await Bun.write(
      entrypoint,
      `
      console.log(JSON.stringify({ profile: process.env.APHRODY_PROFILE, workspace: process.env.APHRODY_WORKSPACE ?? null }));
      if (process.argv.includes("--descendant")) setInterval(() => {}, 1000);
      if (process.argv.includes("--hold")) {
        const child = Bun.spawn([process.execPath, "--descendant"], { windowsHide: true, stdout: "ignore", stderr: "ignore" });
        console.log(JSON.stringify({ childPid: child.pid }));
        process.on("SIGTERM", () => { console.log("stopped"); process.exit(0); });
        setInterval(() => {}, 1000);
      }
    `,
    );
    const binary = await compileDiscordApp({
      entrypoint,
      outfile: join(directory, "discord-fixture"),
    });
    expect(await Bun.file(binary).exists()).toBe(true);
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
    using held = await startDiscordApp({
      binary,
      profile: "dbfr",
      args: ["--hold"],
    });
    let ready = "";
    const deadline = Date.now() + 5000;
    while (!ready.includes("childPid") && Date.now() < deadline) {
      ready += held.takeStdout();
      // oxlint-disable-next-line no-await-in-loop -- wait for the owned process to emit readiness
      await Bun.sleep(10);
    }
    expect(ready).toContain("dbfr");
    const childPid = ready
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((line) => line.childPid)?.childPid;
    expect(typeof childPid).toBe("number");
    expect(() => process.kill(childPid, 0)).not.toThrow();
    expect(held.status().running).toBe(true);
    const stopped = await held.stopAsync(1000);
    expect(stopped.running).toBe(false);
    expect(stopped.exitCode).toBe(process.platform === "win32" ? 1 : 0);
    const finalOutput = held.takeStdout();
    if (process.platform === "win32")
      expect(finalOutput).not.toContain("stopped");
    else expect(finalOutput).toContain("stopped");
    let childAlive = true;
    const childDeadline = Date.now() + 5000;
    while (childAlive && Date.now() < childDeadline) {
      try {
        process.kill(childPid, 0);
      } catch {
        childAlive = false;
      }
      // oxlint-disable-next-line no-await-in-loop -- verify actual process-group teardown
      if (childAlive) await Bun.sleep(10);
    }
    expect(childAlive).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test("the process owner rejects an ambiguous domain before starting anything", async () => {
  await expect(
    startDiscordApp({ binary: "missing", profile: "../aphrody" }),
  ).rejects.toThrow("explicit named");
});

test.skipIf(process.platform !== "win32")(
  "Windows supervisor terminates an independent PowerShell process tree",
  async () => {
    const binary = Bun.which("powershell.exe");
    if (!binary)
      throw new Error(
        "Native Windows PowerShell is required for process-tree qualification",
      );
    using parent = await startDiscordApp({
      binary,
      profile: "dbfr",
      stdio: "capture-lossless",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        '$child=Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList "-NoProfile","-NonInteractive","-Command","Start-Sleep -Seconds 60" -WindowStyle Hidden -PassThru; Write-Output $child.Id; Start-Sleep -Seconds 60',
      ],
    });
    let childPid: number | undefined;
    try {
      let output = "";
      const readyDeadline = Date.now() + 10_000;
      while (!output.includes("\n") && Date.now() < readyDeadline) {
        output += parent.takeStdout();
        // oxlint-disable-next-line no-await-in-loop -- await real descendant readiness
        if (!output.includes("\n")) await Bun.sleep(10);
      }
      childPid = Number(output.trim());
      expect(Number.isSafeInteger(childPid) && childPid > 0).toBe(true);
      expect(() => process.kill(childPid!, 0)).not.toThrow();
      const stopped = await parent.stopAsync(1000);
      expect(stopped.running).toBe(false);
      expect(stopped.exitCode).toBe(1);
      let alive = true;
      const deadline = Date.now() + 5000;
      while (alive && Date.now() < deadline) {
        try {
          process.kill(childPid, 0);
        } catch {
          alive = false;
        }
        // oxlint-disable-next-line no-await-in-loop -- verify native Job Object descendant teardown
        if (alive) await Bun.sleep(10);
      }
      expect(alive).toBe(false);
    } finally {
      // Only the exact child created by this fixture is eligible for cleanup on failure.
      if (childPid && Number.isSafeInteger(childPid)) {
        try {
          process.kill(childPid);
        } catch {
          /* already stopped by its owner */
        }
      }
    }
  },
  30_000,
);
