import { expect, test } from "bun:test";
import { pathToFileURL } from "node:url";

test("repair rejects a managed gameplay host before creating a client and never repairs RG", async () => {
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      "-e",
      `
      import { mock } from "bun:test";
      import { Command } from "commander";
      let connections = 0;
      const queries = [];
      mock.module(${JSON.stringify(pathToFileURL(`${import.meta.dir}/../src/cli/context.ts`).href)}, () => ({
        colors: {}, errorMessage: String,
        createPgClient() { connections++; return {
          async connect() {}, async end() {},
          async query(text) { queries.push(text); return {rows:[{table_name:"inagle_characters"}]}; }
        }; }
      }));
      process.env.INAGLE_DATABASE_URL = "postgresql://fixture@gameplay.neon.invalid/inagle";
      process.env.RG_DATABASE_URL = "postgresql://fixture@business.supabase.invalid/rg";
      const {registerRepairCommand} = await import(${JSON.stringify(pathToFileURL(`${import.meta.dir}/../src/cli/commands/repair.ts`).href)});
      const program = new Command(); registerRepairCommand(program);
      await program.parseAsync(["bun","azalee","repair"]);
      console.log("managed",connections,queries.length);
      process.env.INAGLE_DATABASE_URL = "postgresql://fixture@127.0.0.1/inagle";
      await program.parseAsync(["bun","azalee","repair"]);
      console.log("local",connections,JSON.stringify(queries));
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
  expect(stdout).toContain("managed 0 0");
  expect(stdout).toContain("local 1 [");
  expect(stdout).toContain('ALTER TABLE \\"inagle_characters\\" DISABLE ROW LEVEL SECURITY;');
  expect(stdout).not.toContain("patch_notes");
  expect(stdout).not.toContain("rose_griffon");
  expect(stderr).toContain("restricted to a loopback PostgreSQL host");
  expect(exitCode).toBe(0);
});
