// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";

test("Cron package import exposes contracts without launching its daemon", async () => {
  const entry = Bun.fileURLToPath(new URL("./index.ts", import.meta.url));
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
    const before = [console.log, console.error, console.warn];
    Bun.serve = () => { throw new Error('server launched while importing'); };
    const mod = await import(${JSON.stringify(entry)});
    if (before.some((fn, index) => fn !== [console.log, console.error, console.warn][index])) throw new Error('console mutated');
    if (typeof mod.startCronDaemon !== 'function' || !mod.CATALOGUE_TACHES) throw new Error('missing contracts');
    console.log('import-safe');
  `,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(stderr).toBe("");
  expect(code).toBe(0);
  expect(stdout.trim()).toBe("import-safe");
});
