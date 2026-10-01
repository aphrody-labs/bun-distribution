// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { join } from "node:path";

test.each(["text", "buffer", "typed-view", "data-view", "shared-view"])(
  "CDP decodes %s replies without reading bytes outside the message view",
  async (mode) => {
    // Isolate the transport fixture from tests using a real browser connection.
    const script = `
      const original = globalThis.WebSocket;
      class FixtureSocket extends EventTarget {
        constructor() {
          super();
          queueMicrotask(() => this.dispatchEvent(new Event("open")));
        }
        send(raw) {
          const command = JSON.parse(raw);
          const result = command.method === "Target.createTarget" ? { targetId: "target" }
            : command.method === "Target.attachToTarget" ? { sessionId: "session" }
            : command.method === "Runtime.evaluate" ? { result: { value: "decoded" } } : {};
          const text = JSON.stringify({ id: command.id, result });
          const bytes = new TextEncoder().encode(text);
          const mode = ${JSON.stringify(mode)};
          let data = text;
          if (mode === "buffer") data = bytes.buffer;
          if (mode.endsWith("view")) {
            const storage = mode === "shared-view"
              ? new SharedArrayBuffer(bytes.length + 4) : new ArrayBuffer(bytes.length + 4);
            new Uint8Array(storage).fill(255);
            new Uint8Array(storage, 2, bytes.length).set(bytes);
            data = mode === "data-view" ? new DataView(storage, 2, bytes.length)
              : new Uint8Array(storage, 2, bytes.length);
          }
          queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data })));
        }
        close() { this.dispatchEvent(new Event("close")); }
      }
      globalThis.WebSocket = FixtureSocket;
      const timeout = setTimeout(() => process.exit(2), 2000);
      try {
        const { WebCdpPage } = await import(${JSON.stringify(join(import.meta.dir, "../src/cdp.ts"))});
        const page = await WebCdpPage.connect("ws://fixture.invalid/");
        try { console.log(JSON.stringify(await page.evaluate("'decoded'"))); }
        finally { await page.close(); }
      } finally {
        clearTimeout(timeout);
        globalThis.WebSocket = original;
      }
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(stderr).toBe("");
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toBe("decoded");
  },
);
