#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0

import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

type JsonObject = Record<string, unknown>;

type A2aPeer = {
  id?: string;
  role?: string;
  transport?: string;
  endpoint?: string;
  authEnv?: string | null;
  rpcPath?: string;
  service?: string;
};

type Route = {
  host?: string;
  service?: string;
  via?: string;
  publicHost?: string;
  paths?: string[];
};

const repo = resolve(import.meta.dir, "..");

function fail(message: string): never {
  throw new Error(message);
}

async function readJson<T>(relative: string): Promise<T> {
  return JSON.parse(await Bun.file(join(repo, relative)).text()) as T;
}

async function checkSensitiveFiles(directory: string): Promise<void> {
  const sensitiveName = /^\.env($|\.)|\.pem$|\.key$|\.p12$|\.pfx$|\.sqlite($|[-.])|\.db$|\.dump$|\.sql$/i;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (sensitiveName.test(entry.name)) {
      fail(`Sensitive-looking file detected: ${path.slice(repo.length + 1)}`);
    }
    if (entry.isDirectory()) await checkSensitiveFiles(path);
    else if (entry.isSymbolicLink()) {
      // Do not follow links outside or back into the repository during the scan.
      continue;
    }
  }
}

function hasOwn(value: object, key: string): boolean {
  return Object.hasOwn(value, key);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main(): Promise<void> {
  await checkSensitiveFiles(repo);

  const required = [
    "README.md",
    "inventory/vps-source.json",
    "docs/TOPOLOGY.md",
    "docs/MIGRATION-GUARDRAILS.md",
    "systemd/aphrody-site.service.example",
    "systemd/aphrody-web-api.service.example",
    "systemd/aphrody-a2a.service.example",
    "systemd/aphrody-shenron-embed.service.example",
    "systemd/aphrody-ai-http.service.example",
    "config/local-ai.json",
    "config/local-ai.env.example",
  ];
  for (const relative of required) {
    const path = join(repo, relative);
    try {
      if (!(await stat(path)).isFile()) fail(`Missing required file: ${relative}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Missing required file:")) throw error;
      fail(`Missing required file: ${relative}`);
    }
  }

  await readJson<JsonObject>("inventory/vps-source.json");
  const a2a = await readJson<{ peers: A2aPeer[]; protocol: { rpcPath: string; agentCardPath: string } }>("config/a2a-peers.json");
  const routes = await readJson<{ routes: Route[]; internal: Route[] }>("config/nginx-routes.json");
  const catalog = await readJson<{ services: Array<{ id: string }> }>("config/service-catalog.json");
  const ids = new Set<string>();

  for (const peer of a2a.peers) {
    for (const field of ["id", "role", "transport", "endpoint"] as const) {
      if (!peer[field]) fail(`a2a peer missing ${field}: ${peer.id ?? "<unknown>"}`);
    }

    const id = peer.id!;
    const endpoint = peer.endpoint!;
    const transport = peer.transport!;
    if (ids.has(id)) fail(`duplicate a2a peer: ${id}`);
    ids.add(id);

    if (peer.authEnv && !/^[A-Z][A-Z0-9_]*$/.test(peer.authEnv)) {
      fail(`a2a authEnv must be an env var name: ${id}`);
    }

    if (transport === "https-jsonrpc") {
      const rpcPath = peer.rpcPath ?? a2a.protocol.rpcPath;
      const endpointPattern = new RegExp(`^https://[^/]+${escapeRegExp(rpcPath)}$`);
      if (!endpointPattern.test(endpoint)) fail(`a2a endpoint must end with rpcPath: ${id}`);
      if (!catalog.services.some((service) => service.id === peer.service)) {
        fail(`a2a peer service not in catalog: ${id}`);
      }

      const hostname = new URL(endpoint).hostname;
      const publicRoute = routes.routes.find((route) => route.host === hostname);
      if (!publicRoute) fail(`a2a public host missing: ${hostname}`);
      const route = publicRoute.service === peer.service
        ? publicRoute
        : routes.internal.find((candidate) => candidate.service === peer.service
          && candidate.via === "nginx"
          && hasOwn(candidate, "publicHost")
          && candidate.publicHost === hostname);
      const routePaths = route && hasOwn(route, "paths") ? route.paths ?? [] : [];
      if (!route || (routePaths.length > 0
        && (!routePaths.includes(rpcPath) || !routePaths.includes(a2a.protocol.agentCardPath)))) {
        fail(`a2a nginx route missing for ${hostname}`);
      }
    } else if (transport === "coord-file") {
      if (endpoint !== `.coord/inbox-from-${id}.jsonl`) {
        fail(`a2a coord endpoint violates convention: ${id}`);
      }
    } else {
      fail(`unknown a2a transport: ${transport}`);
    }
  }

  console.log(`a2a-check: ok (${ids.size} peers)`);

  const generator = join(import.meta.dir, "gen-local-ai-env.ts");
  const child = Bun.spawn(["bun", generator, "--check"], {
    cwd: repo,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    fail("config/local-ai.env.example drifted from config/local-ai.json (run bun scripts/gen-local-ai-env.ts).");
  }
  console.log("infra-check: ok");
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
