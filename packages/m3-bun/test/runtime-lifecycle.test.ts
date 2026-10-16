// SPDX-License-Identifier: Apache-2.0
import { afterAll, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "../src/runtime.ts";
import { cleanup, freePort, tmp } from "./helpers.ts";

afterAll(cleanup);

test("stopping a launched process is safe concurrently and after completion", async () => {
  const file = join(tmp(), "server.ts");
  writeFileSync(
    file,
    'Bun.serve({port:Number(Bun.env.PORT),fetch:()=>new Response("ok")});\n',
  );
  const port = freePort();
  const child = await launch(process.execPath, {
    args: [file],
    port,
    env: { PORT: String(port) },
  });
  const [first, second] = await Promise.all([child.stop(), child.stop()]);
  expect(second).toEqual(first);
  expect(await child.stop()).toEqual(first);
  await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toBeDefined();
}, 15_000);

test("cancelling startup stops and joins the spawned process", async () => {
  const dir = tmp();
  const file = join(dir, "idle.ts");
  const marker = join(dir, "pid");
  writeFileSync(
    file,
    `await Bun.write(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);\n`,
  );
  const controller = new AbortController();
  const reason = new Error("cancelled startup");
  const pending = launch(process.execPath, {
    args: [file],
    port: freePort(),
    signal: controller.signal,
  });
  const rejected = pending.then(
    () => undefined,
    (error: unknown) => error,
  );
  const deadline = Date.now() + 5000;
  // eslint-disable-next-line no-await-in-loop -- Observe the spawned process before cancelling startup.
  while (!existsSync(marker) && Date.now() < deadline) await Bun.sleep(10);
  controller.abort(reason);
  expect(await rejected).toBe(reason);
  expect(existsSync(marker)).toBe(true);
  const pid = Number(await Bun.file(marker).text());
  expect(() => process.kill(pid, 0)).toThrow();
}, 15_000);

test("invalid readiness inputs fail before spawning a process", async () => {
  await expect(launch("does-not-exist", { port: 0 })).rejects.toThrow(
    "invalid readiness port",
  );
  await expect(
    launch("does-not-exist", { port: 4000, path: "//other/health" }),
  ).rejects.toThrow("absolute path");
  await expect(
    launch("does-not-exist", { port: 4000, timeoutMs: 0 }),
  ).rejects.toThrow("positive");
});
