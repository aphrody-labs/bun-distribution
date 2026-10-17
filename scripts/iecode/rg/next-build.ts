import { stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { checkBunRuntime } from "../validation/bun-runtime";

export function assertWorkspaceMember(root: string, app: string): void {
  const member = relative(root, app);
  if (
    !member ||
    isAbsolute(member) ||
    member === ".." ||
    member.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  )
    throw new Error("Next build must run from an app inside the Bun OS workspace");
}

export async function assertFreshBuild(app: string, startedAt: number): Promise<void> {
  const path = join(app, ".next", "BUILD_ID");
  const artifact = await stat(path);
  if (!artifact.isFile() || artifact.mtimeMs < startedAt) throw new Error(`Next build output is missing or stale: ${path}`);
}

export async function buildNext(root: string, app: string, args: string[]): Promise<number> {
  await checkBunRuntime(root);
  assertWorkspaceMember(root, app);
  const sync = Bun.spawn(
    [process.execPath, join(root, "packages/rg-assets/scripts/sync-website-public.ts"), "--to", join(app, "public")],
    { cwd: app, stdout: "inherit", stderr: "inherit" },
  );
  const syncExit = await sync.exited;
  if (syncExit !== 0) return syncExit;
  const startedAt = Date.now();
  const runner = (await import(Bun.resolveSync("@aphrody/next-bun/run", app))) as {
    runNext(args: string[], cwd: string): Promise<number>;
  };
  const selectedBundler = args.some(arg => ["--webpack", "--turbopack", "--turbo"].includes(arg)) ? [] : ["--webpack"];
  const exitCode = await runner.runNext(["build", ...selectedBundler, ...args], app);
  if (exitCode !== 0) return exitCode;
  await assertFreshBuild(app, startedAt);
  return 0;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--analyze")) process.env.ANALYZE = "true";
  process.exitCode = await buildNext(
    resolve(import.meta.dir, "../../.."),
    process.cwd(),
    args.filter(arg => arg !== "--analyze"),
  );
}
