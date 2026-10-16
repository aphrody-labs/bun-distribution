// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

test.skipIf(process.platform !== "win32")(
  "terminating the tunnel task also closes the owned listener",
  async () => {
    const fixture = mkdtempSync(join(tmpdir(), "hub-tunnel-owner-"));
    const marker = join(fixture, "child.json");
    const wrapper = join(fixture, "wrapper.ts");
    const runnerPath = fileURLToPath(new URL("./hub-tunnel-service.ts", import.meta.url));
    const childCode = `const s=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>new Response("ready")});await Bun.write(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,url:s.url.href}));await new Promise(()=>{});`;
    await Bun.write(
      wrapper,
      `import {runOwnedTunnel} from ${JSON.stringify(runnerPath)};await runOwnedTunnel([process.execPath,"--no-env-file","-e",${JSON.stringify(childCode)}],${JSON.stringify(fixture)},${JSON.stringify(join(fixture, "log.txt"))});`,
    );
    const runner = Bun.spawn([process.execPath, "--no-env-file", wrapper], {
      stdout: "ignore",
      stderr: "pipe",
      windowsHide: true,
    });
    try {
      // Watch the actual readiness event instead of delaying the test by a fixed sleep.
      const watcher = (await import("node:fs")).watch(fixture);
      const ready = new Promise<void>((resolveReady) =>
        watcher.on("change", () => {
          if (Bun.file(marker).size > 0) resolveReady();
        }),
      );
      await Promise.race([
        ready,
        runner.exited.then(() => {
          throw new Error("Tunnel wrapper exited before readiness");
        }),
      ]);
      watcher.close();
      const child = (await Bun.file(marker).json()) as { pid: number; url: string };
      expect((await fetch(child.url)).status).toBe(200);
      runner.kill("SIGKILL");
      await runner.exited;
      await expect(fetch(child.url, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
    } finally {
      if (runner.exitCode === null) runner.kill("SIGKILL");
      await runner.exited;
      rmSync(fixture, { recursive: true, force: true });
    }
  },
  5000,
);
