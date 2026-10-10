// SPDX-License-Identifier: Apache-2.0
// Live end-to-end: real PTY backend over WebSocket -> WASM VT core. Needs the built wasm pkg and
// APHRODY_SHELL_LIVE_BIN (path to the `serve` example binary); skipped otherwise.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { attach, sandboxTransport, webSocketTransport, type WasmApi } from "../src/index";

const bin = process.env.APHRODY_SHELL_LIVE_BIN;
const pkg = new URL("../pkg/", import.meta.url);
const ready = !!bin && existsSync(bin) && existsSync(new URL("aphrody_shell_web_bg.wasm", pkg));

test.skipIf(!ready)(
  "browser transport drives a real PTY shell",
  async () => {
    const mod = await import(new URL("aphrody_shell_web.js", pkg).href);
    await mod.default({ module_or_path: readFileSync(new URL("aphrody_shell_web_bg.wasm", pkg)) });
    const port = 20000 + Math.floor(Math.random() * 20000);
    const server = Bun.spawn([bin!, `127.0.0.1:${port}`], {
      windowsHide: true,
      env: { ...process.env, APHRODY_OS_AUTH_TOKEN: "t0k3n" },
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      await Bun.sleep(500);
      const t = webSocketTransport(mod as WasmApi, `ws://127.0.0.1:${port}/?token=t0k3n`);
      const term = attach(mod as WasmApi, t, 100, 20);
      await Bun.sleep(500);
      term.type("echo live-$((20+22))\r");
      let text = "";
      for (let i = 0; i < 40 && !text.includes("live-42\n"); i++) {
        // oxlint-disable-next-line no-await-in-loop -- poll loop: waits for the live output to appear, bounded by the retry count
        await Bun.sleep(100);
        text = term.snapshot().lines.join("\n") + "\n";
      }
      expect(text).toContain("live-42");
      term.close();
      const sandbox = sandboxTransport(mod as WasmApi, `ws://127.0.0.1:${port}/`, "t0k3n", {
        maxReconnects: 0,
      });
      const sandboxTerm = attach(mod as WasmApi, sandbox, 100, 20);
      await Bun.sleep(500);
      sandboxTerm.type("echo sandbox-42\r");
      let sandboxText = "";
      for (let i = 0; i < 40 && !sandboxText.includes("sandbox-42\n"); i++) {
        // oxlint-disable-next-line no-await-in-loop -- poll loop: waits for the sandbox output to appear, bounded by the retry count
        await Bun.sleep(100);
        sandboxText = sandboxTerm.snapshot().lines.join("\n") + "\n";
      }
      expect(sandboxText).toContain("sandbox-42");
      sandboxTerm.close();

      const sessionId = `resume-${port}`;
      const first = sandboxTransport(mod as WasmApi, `ws://127.0.0.1:${port}/`, "t0k3n", {
        sessionId,
        maxReconnects: 0,
      });
      const firstTerm = attach(mod as WasmApi, first, 100, 20);
      await Bun.sleep(300);
      firstTerm.type("cd /tmp\r");
      await Bun.sleep(300);
      firstTerm.type("sleep 0.3; echo queued-42\r");
      await Bun.sleep(100);
      firstTerm.close();
      await Bun.sleep(500);
      const resumed = sandboxTransport(mod as WasmApi, `ws://127.0.0.1:${port}/`, "t0k3n", {
        sessionId,
        maxReconnects: 0,
      });
      const resumedTerm = attach(mod as WasmApi, resumed, 100, 20);
      await Bun.sleep(300);
      resumedTerm.type("pwd\r");
      let resumedText = "";
      for (
        let i = 0;
        i < 40 && !(resumedText.includes("/tmp") && resumedText.includes("queued-42"));
        i++
      ) {
        // oxlint-disable-next-line no-await-in-loop -- poll loop: waits for the expected state, bounded by the retry count
        await Bun.sleep(100);
        resumedText = resumedTerm.snapshot().lines.join("\n");
      }
      expect(resumedText).toContain("/tmp");
      expect(resumedText).toContain("queued-42");
      resumedTerm.close();
    } finally {
      server.kill();
    }
  },
  20000,
);
