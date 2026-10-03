#!/usr/bin/env bun
/**
 * Local development wiring for Shenron (Windows and WSL alike).
 *
 *   bun scripts/dev/local-env.ts env --profile=dev   # local endpoints, no prod Discord token
 *   bun scripts/dev/local-env.ts env --profile=prod  # production endpoints and credentials
 *   bun scripts/dev/local-env.ts tunnels   # open one SSH tunnel per remote service (foreground)
 *   bun scripts/dev/local-env.ts status    # probe every local tunnel port
 *
 * Remote ports come from service catalog (`config/service-catalog.json`), never
 * from this file. Each remote port P is exposed locally on P + LOCAL_OFFSET so a tunnel never
 * collides with a service running on the workstation itself (local PostgreSQL, WSL Redis…).
 * SSH targets are the `~/.ssh/config` aliases `vps` (shared VPS) and `dbfr` (database host).
 *
 * The generated `.env.local` files are git-ignored. Secrets are copied, never printed.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
/** Service catalog: APHRODY_INFRA_DIR, or the first enclosing checkout that carries config/service-catalog.json. */
function catalogPath(): string {
	const env = Bun.env.APHRODY_INFRA_DIR;
	if (env) return join(env, "config", "service-catalog.json");
	for (let dir = ROOT; ; dir = dirname(dir)) {
		const candidate = join(dir, "config", "service-catalog.json");
		if (existsSync(candidate)) return candidate;
		if (dirname(dir) === dir) return join(ROOT, "config", "service-catalog.json");
	}
}
const CATALOG = catalogPath();
const LOCAL_OFFSET = 10_000;

type CatalogService = { id: string; health?: string; target?: string };
type Tunnel = { id: string; ssh: string; remotePort: number; localPort: number };

async function readCatalog(): Promise<CatalogService[]> {
	if (!existsSync(CATALOG)) throw new Error(`aphrody-infra catalog not found: ${CATALOG}`);
	const raw = (await Bun.file(CATALOG).json()) as Record<string, unknown>;
	const list = (raw.services ?? raw.workloads ?? Object.values(raw).find(Array.isArray)) as
		| CatalogService[]
		| undefined;
	if (!list) throw new Error("service catalog has no service list");
	return list;
}

function portOf(url: string | undefined): number | null {
	const match = url?.match(/:(\d{2,5})(?:\/|$)/);
	return match ? Number(match[1]) : null;
}

/** Services Shenron talks to during development, resolved from the infra catalog. */
async function resolveTunnels(): Promise<Tunnel[]> {
	const catalog = await readCatalog();
	const byId = new Map(catalog.map((s) => [s.id, s]));
	const tunnels: Tunnel[] = [];
	const add = (id: string, ssh: string, remotePort: number | null, localPort?: number | null) => {
		if (remotePort)
			tunnels.push({ id, ssh, remotePort, localPort: localPort ?? remotePort + LOCAL_OFFSET });
	};
	// PostgreSQL lives on the database host; the catalog records it as `dbfr:127.0.0.1:<port>`.
	const pg = byId.get("shenron-pg-tunnel");
	// Local port = the catalog health port of shenron-pg-tunnel, so DATABASE_URL matches production.
	add("postgres", "dbfr", portOf(pg?.target ?? "") ?? 5432, portOf(pg?.health));
	add("redis", "vps", 6379);
	for (const id of ["aphrody-ai-http", "aphrody-shenron-embed", "shenron-bot", "shenron-mcp"]) {
		add(id, "vps", portOf(byId.get(id)?.health));
	}
	return tunnels;
}

/** Parses a dotenv file; later keys win (same rule as Bun's loader). Tolerates CRLF. */
function parseEnv(text: string): Map<string, string> {
	const env = new Map<string, string>();
	for (const line of text.split(/\r?\n/)) {
		const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
		if (match) env.set(match[1], match[2]);
	}
	return env;
}

async function writeEnv(): Promise<void> {
	const profile = (Bun.argv.find((arg) => arg.startsWith("--profile="))?.split("=", 2)[1] ?? "dev") as
		| "dev"
		| "prod";
	if (profile !== "dev" && profile !== "prod") throw new Error("profile must be dev or prod");
	const rootEnv = join(ROOT, ".env");
	if (!existsSync(rootEnv)) throw new Error("root .env missing");
	const base = parseEnv(await Bun.file(rootEnv).text());
	const tunnels = profile === "dev" ? new Map((await resolveTunnels()).map((t) => [t.id, t.localPort])) : new Map();
	const local = (id: string) => tunnels.get(id) as number;

	// NODE_ENV is owned by the command (next dev / next build / bun test), never by a file.
	base.delete("NODE_ENV");
	base.set("SHENRON_RUNTIME", profile);
	const tokenKeys = ["DISCORD_TOKEN", "DISCORD_TOKEN_SHENRON", "DISCORD_TOKEN_BEERUS", "DISCORD_TOKEN_WHIS", "DISCORD_TOKEN_GRAND_PRETRE", "DISCORD_TOKEN_ENMA", "DISCORD_TOKEN_KAIO"];
	for (const key of tokenKeys) {
		const scoped = base.get(`${key}_${profile.toUpperCase()}`);
		const legacy = base.get(key);
		base.delete(key);
		if (scoped ?? (profile === "prod" ? legacy : undefined)) base.set(key, scoped ?? legacy!);
	}
	for (const key of ["DISCORD_TOKEN_DEV", "DISCORD_TOKEN_PROD"]) base.delete(key);
	// AI names: the writer emits the canonical APHRODY_AI_* names of the aphrody-infra
	// contract (config/local-ai.json) and drops the legacy aliases it replaces, so a
	// stale alias from the root .env can never shadow a tunnel. The token keeps its
	// value, whichever name the root .env used.
	const aiToken = base.get("APHRODY_AI_HTTP_TOKEN") ?? base.get("APHRODY_SHENRON_API_TOKEN");
	for (const legacy of [
		"APHRODY_SHENRON_API_URL",
		"APHRODY_SHENRON_API_TOKEN",
		"EMBED_URL",
		"APHRODY_SHENRON_EMBED_BASE_URL",
		"APHRODY_RAG_EMBED_ENDPOINT",
	]) {
		base.delete(legacy);
	}
	const shared: Record<string, string> = {
		...(profile === "dev" ? {
			DATABASE_URL: "postgresql://127.0.0.1:5432/shenron_site",
			REDIS_URL: "redis://127.0.0.1:16379",
			APHRODY_AI_HTTP_URL: `http://127.0.0.1:${local("aphrody-ai-http")}`,
			APHRODY_AI_EMBED_BASE_URL: `http://127.0.0.1:${local("aphrody-shenron-embed")}/v1`,
		} : {}),
		...(aiToken ? { APHRODY_AI_HTTP_TOKEN: aiToken } : {}),
		SHENRON_API_URL: profile === "dev" ? "http://127.0.0.1:15006" : "https://bot.dragonballfr.com",
		SITE_INTERNAL_URL: profile === "dev" ? "http://127.0.0.1:3000" : "https://dragonballfr.com",
	};
	const perApp: Record<string, Record<string, string>> = {
		site: {
			...shared,
			BETTER_AUTH_URL: profile === "dev" ? "http://localhost:3000" : "https://dragonballfr.com",
			NEXT_PUBLIC_SITE_URL: profile === "dev" ? "http://localhost:3000" : "https://dragonballfr.com",
			NEXT_PUBLIC_SHENRON_API_URL: profile === "dev" ? "http://127.0.0.1:15006" : "https://bot.dragonballfr.com",
			OAUTH_REDIRECT_URI: profile === "dev" ? "http://localhost:3000/api/auth/callback/discord" : "https://dragonballfr.com/api/auth/callback/discord",
		},
		bot: { ...shared, BETTER_AUTH_URL: profile === "dev" ? "http://localhost:5006" : "https://bot.dragonballfr.com", OAUTH_REDIRECT_URI: profile === "dev" ? "http://localhost:5006/api/auth/callback/discord" : "https://bot.dragonballfr.com/api/auth/callback/discord", API_HOST: "127.0.0.1" },
	};

	for (const [app, overrides] of Object.entries(perApp)) {
		const merged = new Map(base);
		for (const [key, value] of Object.entries(overrides)) merged.set(key, value);
		const body = [
			"# Generated by scripts/dev/local-env.ts — do not edit, do not commit.",
			`# Profile: ${profile}`,
			"# Source: root .env (deduplicated, last wins) + profile-specific endpoints.",
			...[...merged].map(([k, v]) => `${k}=${v}`),
			"",
		].join("\n");
		const target = join(ROOT, "apps", app, ".env.local");
		await Bun.write(target, body);
		console.log(`wrote apps/${app}/.env.local (${merged.size} keys)`);
	}
}

async function probe(port: number): Promise<boolean> {
	try {
		const socket = await Bun.connect({
			hostname: "127.0.0.1",
			port,
			socket: { data() {}, open() {} },
		});
		socket.end();
		return true;
	} catch {
		return false;
	}
}

async function status(): Promise<number> {
	let down = 0;
	for (const t of await resolveTunnels()) {
		const up = await probe(t.localPort);
		if (!up) down++;
		console.log(
			`${up ? "up  " : "DOWN"} ${t.id.padEnd(22)} 127.0.0.1:${t.localPort} -> ${t.ssh}:${t.remotePort}`
		);
	}
	return down ? 1 : 0;
}

async function openTunnels(): Promise<never> {
	const all = await resolveTunnels();
	const tunnels: Tunnel[] = [];
	for (const t of all) {
		if (await probe(t.localPort)) console.log(`skip ${t.id}: 127.0.0.1:${t.localPort} already open`);
		else tunnels.push(t);
	}
	if (tunnels.length === 0) {
		console.log("all tunnels already open");
		process.exit(0);
	}
	const groups = Map.groupBy(tunnels, (t) => t.ssh);
	const procs = [...groups].map(([host, list]) => {
		const forwards = list.flatMap((t) => ["-L", `127.0.0.1:${t.localPort}:127.0.0.1:${t.remotePort}`]);
		console.log(`ssh ${host}: ${list.map((t) => `${t.id}=${t.localPort}`).join(" ")}`);
		return Bun.spawn(
			[
				"ssh",
				"-N",
				"-o",
				"BatchMode=yes",
				"-o",
				"ExitOnForwardFailure=yes",
				"-o",
				"ServerAliveInterval=30",
				"-o",
				"ServerAliveCountMax=3",
				...forwards,
				host,
			],
			{ stdout: "inherit", stderr: "inherit" }
		);
	});
	const code = await Promise.race(procs.map((p) => p.exited));
	for (const p of procs) p.kill();
	process.exit(code || 1);
}

const command = Bun.argv[2] ?? "status";
if (command === "env") await writeEnv();
else if (command === "tunnels") await openTunnels();
else if (command === "status") process.exit(await status());
else {
	console.error("usage: bun scripts/dev/local-env.ts <env|tunnels|status> [--profile=dev|prod]");
	process.exit(2);
}
