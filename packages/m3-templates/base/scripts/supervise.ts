// Dev supervisor on the native runtime: starts the server in its own process group, waits until it
// answers /health, forwards its output and stops it in order (SIGTERM, then SIGKILL) on Ctrl-C.
import { ProcessExitedError, Runtime } from "@aphrody/runtime-sdk";

const port = Number(Bun.env["PORT"] ?? 3000);
using runtime = Runtime.load();
const child = runtime.spawn({
  program: process.execPath,
  args: ["run", "src/server.ts"],
  env: { PORT: String(port), DB_PATH: Bun.env["DB_PATH"] ?? "data/app.sqlite" },
  stdio: "capture",
});

const pump = setInterval(() => {
  const out = child.takeStdout();
  if (out) process.stdout.write(out);
  const err = child.takeStderr();
  if (err) process.stderr.write(err);
}, 100);

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(pump);
  console.log(`\n${signal}: stopping the server…`);
  const status = await child.stopAsync(2000);
  console.log(`server exited (signal ${status.signal}, code ${status.exitCode})`);
  child.release();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await child.waitForHttp({ port, path: "/health", timeoutMs: 15_000, accept: s => s === 200 });
  console.log(`ready: http://127.0.0.1:${port}`);
} catch (error) {
  if (error instanceof ProcessExitedError) console.error(child.stderrTail());
  await shutdown("startup failure");
  throw error;
}
await child.waitForExit();
