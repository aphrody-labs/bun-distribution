// SPDX-License-Identifier: Apache-2.0
/** Runtime configuration of play.aphrody.app, from the environment (see bun-os-play.env on the VPS). */
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const env = Bun.env;
const home = homedir();

/** Release root: the directory holding `server.js`, `public/` and `nginx/` (dev: the app directory). */
export const releaseRoot = resolve(
  env.PLAY_ROOT ?? join(import.meta.dir, "..", ".."),
);
/** Mutable state: sessions secret, bun-engine usr tree, nginx prefix. */
export const dataRoot = resolve(
  env.PLAY_DATA ?? join(home, "apps", "play", "data"),
);

export const config = {
  /** Bun.serve listener; only the NGINX engine and local tools reach it. */
  hostname: env.PLAY_HOST ?? "127.0.0.1",
  port: Number(env.PLAY_PORT ?? 18481),
  /** Public origin served through Cloudflare and the distro NGINX TLS front. */
  publicOrigin: env.PLAY_PUBLIC_ORIGIN ?? "https://play.aphrody.app",
  /** WireGuard mesh listener of the engine that proves tunnel identity (sign-in bridge). */
  tunnelOrigin: env.PLAY_TUNNEL_ORIGIN ?? "http://10.200.77.1:18482",
  /** SteamID64 values allowed to sign in with Steam OpenID. Empty disables the Steam method. */
  steamIds: (env.PLAY_STEAM_IDS ?? "")
    .split(/[\s,]+/)
    .filter((id) => /^\d{17}$/.test(id)),
  secretsDir: resolve(
    env.PLAY_SECRETS ?? join(home, ".aphrody", "secrets", "play"),
  ),
  sessionHours: Number(env.PLAY_SESSION_HOURS ?? 12),
  /** Static client produced by scripts/build.ts. */
  publicDir: join(releaseRoot, "public"),
  /** Web emulation artifacts (`<core>/{*.wasm,*.js,manifest.json}`) published by the emulation owner. */
  emulationDir: resolve(
    env.PLAY_EMULATION_DIR ?? join(releaseRoot, "public", "emulation"),
  ),
  /** LAN cache audit of packages/bun-steam/src/lancache.ts. */
  lancacheUrl: env.PLAY_LANCACHE_URL ?? "http://127.0.0.1:8099/_lancache/audit",
  /** Signalling WebSocket of the packages/bun-gamestream server (stream container, wg1). */
  gamestreamWs: env.PLAY_GAMESTREAM_WS ?? "ws://10.200.77.1:8797/ws",
  gamestreamHealth:
    env.PLAY_GAMESTREAM_HEALTH ?? "http://10.200.77.1:8797/healthz",
  /** Steam client root; empty selects bun-steam's resolver. */
  steamRoot: env.PLAY_STEAM_ROOT || undefined,
  nginx: {
    binary:
      env.PLAY_NGINX_BINARY ??
      join(home, "apps", "play", "nginx", "sbin", "nginx"),
    prefix: resolve(
      env.PLAY_NGINX_PREFIX ?? join(home, "apps", "play", "nginx"),
    ),
    template: join(releaseRoot, "nginx", "engine.conf"),
    loopbackListen: env.PLAY_NGINX_LISTEN ?? "127.0.0.1:18480",
    tunnelListen: env.PLAY_NGINX_TUNNEL_LISTEN ?? "10.200.77.1:18482",
    infoPort: Number(env.PLAY_NGINX_INFO_PORT ?? 18483),
    enabled: env.PLAY_NGINX !== "0",
  },
} as const;

export type PlayConfig = typeof config;
