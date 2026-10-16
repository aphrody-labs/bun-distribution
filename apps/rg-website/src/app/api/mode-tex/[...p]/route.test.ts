import { expect, test } from "bun:test";
import { pathToFileURL } from "node:url";

test("route collection does not access an absent protected workspace and runtime reports unavailable textures", async () => {
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      "-e",
      `
		import {join} from "node:path";
		import {tmpdir} from "node:os";
		const absent=join(tmpdir(),"iecode-mode-tex-missing-"+crypto.randomUUID());
		process.env.APHRODY_ROOT=absent;
		delete process.env.APHRODY_WORKSPACE_ROOT;
		delete process.env.APHRODY_IECODE_ROOT;
		delete process.env.IECODE_ROOT;
		delete process.env.NIE_ROOT;
		delete process.env.DATA_PATH;
		delete process.env.DATA_ROOT;
		delete process.env.NIE_DATA_ROOT;
		const {GET}=await import(${JSON.stringify(pathToFileURL(`${import.meta.dir}/route.ts`).href)});
		console.log("route imported without reading a protected store");
		const response=await GET(new Request("http://localhost/api/mode-tex/fixture.png"),{params:Promise.resolve({p:["fixture.png"]})});
		console.log(response.status,await response.text());
		process.env.DATA_PATH=absent;
		const missing=await GET(new Request("http://localhost/api/mode-tex/fixture.png"),{params:Promise.resolve({p:["fixture.png"]})});
		console.log(missing.status,await missing.text());
	`,
    ],
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stdout.trim()).toBe(
    "route imported without reading a protected store\n503 texture source unavailable\n503 texture source unavailable",
  );
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
