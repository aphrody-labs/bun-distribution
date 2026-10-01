import { expect, test } from "bun:test";
import { join } from "node:path";

// Keep database module mocks inside a separate process so other API tests retain
// their real module graph. Completed lobbies must never apply Elo or notify twice.
test.each(["Finished", "Canceled"])(
  "admin resolution does not reapply a %s lobby",
  async (state) => {
    const database = join(import.meta.dir, "db.ts");
    const persistence = join(import.meta.dir, "persistence.ts");
    const script = `
    import { mock } from "bun:test";
    let queries = 0;
    mock.module(${JSON.stringify(database)}, () => ({
      sql: async () => { queries++; return [{ state: ${JSON.stringify(state)} }]; },
      getRanks: () => { throw new Error("Ranks must not be fetched for a completed lobby"); },
    }));
    const { adminResolveLobby } = await import(${JSON.stringify(persistence)});
    const result = await adminResolveLobby(42, 3, 1, undefined, 2, 32);
    console.log(JSON.stringify({ result, queries }));
  `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: import.meta.dir,
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
    expect(JSON.parse(stdout)).toEqual({
      result: { applied: false, eloDelta: { p1: 0, p2: 0 } },
      queries: 1,
    });
  },
);
