// SPDX-License-Identifier: Apache-2.0
// Starts the windex PostgreSQL and Redis containers (tools/config/container/compose.windex.yaml) after generating
// their passwords once under <home>/private/windex. Never removes a container volume.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ensureSecret, readSecret, type Config } from "./config.ts";

export const COMPOSE_FILE = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "tools",
  "config",
  "container",
  "compose.windex.yaml",
);

export async function compose(cfg: Config, args: string[]): Promise<{ code: number; out: string }> {
  const secret = (f: string) => (existsSync(f) ? readSecret(f) : "");
  const proc = Bun.spawn(["docker", "compose", "-f", COMPOSE_FILE, ...args], {
    // The passwords live only in this child's environment; Compose copies them into the containers as secrets.
    env: {
      ...process.env,
      APHRODY_HOME: cfg.home,
      WINDEX_PG_PORT: String(cfg.pg.port),
      WINDEX_REDIS_PORT: String(cfg.redis.port),
      WINDEX_PG_PASSWORD: secret(cfg.pg.passwordFile),
      WINDEX_REDIS_PASSWORD: secret(cfg.redis.passwordFile),
    },
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, out: `${out}${err}` };
}

/** Generates missing passwords, then `docker compose up -d --wait` (healthchecks must pass). */
export async function up(cfg: Config): Promise<{ generated: string[]; out: string }> {
  const generated: string[] = [];
  for (const f of [cfg.pg.passwordFile, cfg.redis.passwordFile])
    if (ensureSecret(f)) generated.push(f);
  const r = await compose(cfg, ["up", "-d", "--wait", "--wait-timeout", "180"]);
  if (r.code !== 0) throw new Error(`docker compose up a échoué (${r.code}) :\n${r.out}`);
  return { generated, out: r.out };
}

export async function ps(cfg: Config): Promise<string> {
  return (await compose(cfg, ["ps", "--format", "table {{.Name}}\t{{.Status}}\t{{.Ports}}"])).out;
}
