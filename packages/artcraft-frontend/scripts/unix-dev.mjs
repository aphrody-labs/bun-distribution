#!/usr/bin/env bun
// Combined native desktop launcher. Invoked through Bun on Windows, macOS and Linux.
import { resolve, join } from "node:path";
import { buildFrontend, serveFrontend, watchDevelopment, frontendDir } from "./artcraft.ts";

const rootDir = resolve(frontendDir, "..");
const rustDir = join(rootDir, "crates/desktop/artcraft");
const startingPort = Number(Bun.env.ARTCRAFT_DEV_PORT ?? "5193");
if (!Number.isInteger(startingPort) || startingPort < 0 || startingPort > 65535) {
  throw new Error("ARTCRAFT_DEV_PORT must be a valid port (0 chooses a free port).");
}
Bun.env.VITE_ENVIRONMENT_TYPE ??= "production";
await buildFrontend({ development: true });
let server;
for (let offset = 0; offset < 20; offset++) {
  try {
    server = serveFrontend({
      port: startingPort === 0 ? 0 : startingPort + offset,
      development: true,
    });
    break;
  } catch (error) {
    if (error.code !== "EADDRINUSE" || offset === 19) throw error;
  }
}
const closeWatchers = watchDevelopment(server);
const devUrl = server.url.origin;
const configPath = join(rustDir, "tauri-dev-hot-reload.conf.json");
const config = await Bun.file(configPath).json();
const csp = config.app.security.csp;
const overrides = {
  build: { devUrl, beforeDevCommand: "" },
  app: {
    security: {
      devCsp: {
        ...csp,
        "connect-src": [...csp["connect-src"], devUrl, devUrl.replace("http:", "ws:")],
      },
    },
  },
};
console.log(`[bun] Bun frontend with page reload: ${devUrl}`);
const rust = Bun.spawn(
  [
    "cargo",
    "tauri",
    "dev",
    "--no-dev-server",
    "--additional-watch-folders",
    join(rootDir, ".sqlx"),
    "--additional-watch-folders",
    join(rootDir, "_database/sql/artcraft_migrations"),
    "--config",
    configPath,
    "--config",
    JSON.stringify(overrides),
  ],
  {
    cwd: rootDir,
    detached: process.platform !== "win32",
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
    env: {
      ...Bun.env,
      TAURI_FRONTEND_PATH: frontendDir,
      TAURI_APP_PATH: rustDir,
      SQLX_OFFLINE: Bun.env.SQLX_OFFLINE ?? "true",
      RUSTFLAGS: Bun.env.RUSTFLAGS ?? "-Awarnings",
    },
  },
);
let stopping = false;
async function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  closeWatchers();
  server.stop(true);
  if (process.platform === "win32") {
    const kill = Bun.spawn(["taskkill", "/PID", String(rust.pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
      timeout: 5000,
    });
    await kill.exited;
  } else {
    try {
      process.kill(-rust.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    const deadline = setTimeout(() => {
      try {
        process.kill(-rust.pid, "SIGKILL");
      } catch {}
    }, 5000);
    await Promise.race([rust.exited, Bun.sleep(5000)]);
    clearTimeout(deadline);
  }
  process.exit(exitCode);
}
process.on("SIGINT", () => void stop(130));
process.on("SIGTERM", () => void stop(143));
process.on("SIGHUP", () => void stop(129));
process.on("uncaughtException", (error) => {
  console.error(error);
  void stop(1);
});
process.on("unhandledRejection", (error) => {
  console.error(error);
  void stop(1);
});
await rust.exited;
await stop(rust.exitCode ?? 1);
