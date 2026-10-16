// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artifactHandler } from "../src/admin/lib/fleet/artifacts.ts";

test("private delivery authorizes exact files and never exposes arbitrary depot paths", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aphrody-gpu-depot-"));
  const token = "a".repeat(64);
  try {
    await Bun.write(join(directory, "config.json"), '{"model":true}');
    await Bun.write(join(directory, "api.token"), "protected");
    const handler = artifactHandler(directory, token);
    expect(
      (await handler(new Request("http://localhost/config.json"))).status,
    ).toBe(401);
    const headers = { authorization: `Bearer ${token}` };
    expect(
      (await handler(new Request("http://localhost/api.token", { headers })))
        .status,
    ).toBe(404);
    expect(
      (
        await handler(
          new Request("http://localhost/%2e%2e/api.token", { headers }),
        )
      ).status,
    ).toBe(404);
    const response = await handler(
      new Request("http://localhost/config.json", { headers }),
    );
    expect(await response.text()).toBe('{"model":true}');
    const resumed = await handler(
      new Request("http://localhost/config.json", {
        headers: { ...headers, range: "bytes=3-" },
      }),
    );
    expect(resumed.status).toBe(206);
    expect(await resumed.text()).toBe('odel":true}');
    expect(
      (
        await handler(
          new Request("http://localhost/config.json", {
            headers: { ...headers, range: "bytes=999-" },
          }),
        )
      ).status,
    ).toBe(416);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(
      (
        await handler(
          new Request("http://localhost/config.json", {
            headers,
            method: "POST",
          }),
        )
      ).status,
    ).toBe(405);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
