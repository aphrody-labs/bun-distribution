// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWeb, webOptions } from "../src/web.ts";

test("product web serves the selected artifact on loopback without checkout defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "aphrody-product-web-"));
  let server: Awaited<ReturnType<typeof startWeb>> | undefined;
  try {
    await Bun.write(join(root, "index.html"), "product-web-fixture");
    const args = ["--root", root, "--port", "0"];
    expect(webOptions(args, {}).hostname).toBe("127.0.0.1");
    expect(webOptions(args, { APHRODY_SITE_BIND: "[::1]:3100" }).hostname).toBe("::1");
    expect(
      webOptions([], {
        APHRODY_APP_UI_ROOT: root,
        APHRODY_SITE_BIND: "127.0.0.1:9000",
        PORT: "8000",
      }),
    ).toEqual({
      staticRoot: root,
      hostname: "127.0.0.1",
      port: 9000,
    });
    expect(() => webOptions(["--root", root, "--port", "65536"], {})).toThrow("port");
    expect(() => webOptions(["--unknown"], {})).toThrow();
    server = await startWeb(args, {});
    const response = await fetch(server.url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("product-web-fixture");
  } finally {
    server?.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});
