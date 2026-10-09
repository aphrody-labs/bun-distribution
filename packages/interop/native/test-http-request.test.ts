// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { loadNativeLibrary } from "./src/library.ts";

let available = false;
try {
  loadNativeLibrary();
  available = true;
} catch (error) {
  if (process.env.APHRODY_FFI_REQUIRE_NATIVE === "1") throw error;
}

(available ? test : test.skip)(
  "native Web HTTP request preserves authenticated methods and manual redirect",
  async () => {
    const program = `
    import { WebHttpClient } from "./src/web.ts";
    let requests = 0;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      requests++;
      if (request.headers.get("x-ut-sid") !== "fixture-session") throw new Error("session header lost");
      if (request.headers.get("cookie") !== "sid=fixture-cookie") throw new Error("cookie header lost");
      if (request.method !== "GET" && await request.text() !== '{"item":42}') throw new Error("body lost");
      return request.method === "DELETE" ? new Response(null, { status: 302, headers: { location: "/must-not-follow" } }) : Response.json({ method: request.method });
    }});
    try {
      const client = new WebHttpClient();
      for (const method of ["GET", "POST", "PUT", "DELETE"]) {
        const response = await client.fetch(server.url.href, { method, headers: { "x-ut-sid": "fixture-session" }, cookies: "sid=fixture-cookie", body: method === "GET" ? undefined : '{"item":42}', redirect: "manual" });
        if (method === "DELETE") {
          if (response.status !== 302 || response.headers.get("location") !== "/must-not-follow") throw new Error("redirect changed");
        } else if ((await response.json()).method !== method) throw new Error("method changed");
        if (response.url !== server.url.href) throw new Error("response URL lost");
      }
      if (requests !== 4) throw new Error("redirect was followed");
      console.log("native-request-ok");
    } finally { server.stop(true); }
  `;
    const child = Bun.spawn([process.execPath, "--eval", program], {
      windowsHide: true,
      cwd: import.meta.dir,
      env: { ...process.env, OBSCURA_ALLOW_PRIVATE_NETWORK: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(child.stdout).text();
    const error = await new Response(child.stderr).text();
    expect(await child.exited, error).toBe(0);
    expect(output.trim()).toBe("native-request-ok");
  },
  30_000,
);
