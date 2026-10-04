// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";

// Requires the pinned SDK with /desktop and a built native host; skips are not rendering proof.
const executable = process.env.YOLO_DESKTOP_TEST_BIN;
describe.skipIf(executable === undefined)("product startup through precompiled desktop SDK", () => {
  test("product UI loads and lifetime cancellation stops its native session", async () => {
    const { launchNativeDesktop } = await import("../src/native-desktop");
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        new Response("<!doctype html><title>Aphrody</title><h1>Aphrody native product UI</h1>", {
          headers: { "content-type": "text/html" },
        }),
    });
    const controller = new AbortController();
    try {
      const product = await launchNativeDesktop({
        url: String(server.url),
        title: "Aphrody desktop SDK",
        executable: executable!,
        signal: controller.signal,
      });
      try {
        expect(await product.window.info()).toMatchObject({ visible: true });
        controller.abort(new Error("product lifetime ended"));
        await product.close();
        await expect(product.session.events()).rejects.toMatchObject({ code: "SessionClosed" });
      } finally {
        await product.close();
      }
    } finally {
      server.stop(true);
    }
  }, 30_000);
});
