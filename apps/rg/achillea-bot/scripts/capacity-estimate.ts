#!/usr/bin/env bun
/**
 * Estimation MATHÉMATIQUE de capacité — matchs ranked simultanés.
 * ----------------------------------------------------------------
 * Ne devine rien : mesure le réel puis applique un modèle.
 *   1. Hardware    — cœurs CPU, RAM, limite FD, charge (os + /proc).
 *   2. Config code — maxClients lobby/queue, pool Bun.SQL, modes (regex sur la source).
 *   3. Tests       — inventorie TOUS les *.test.ts / *.spec.ts (bot + web), en dérive
 *                    le profil d'opérations d'un cycle de match (patches d'état, messages).
 *   4. Micro-bench — vraies fonctions du repo (core/ranked), Elo (K=32), encodage d'état,
 *                    mémoire réelle par room (heapUsed delta).
 *   5. SUPABASE    — sonde l'instance réelle : max_connections, connexions en cours, débit
 *                    de requêtes concurrentes mesuré. Applique le profil du PLAN (free/pro) :
 *                    plafond connexions, débit compute, EGRESS mensuel, taille DB/stockage.
 *   6. Frontend    — poids du bundle Angular servi → débit de chargements à froid.
 *   7. Modèle      — loi de Little L = λ·W par dimension (CPU/RAM/DB/WS) ; egress = plafond
 *                    MENSUEL séparé. Contrainte liante = min des dimensions instantanées.
 *
 * Usage : bun scripts/capacity-estimate.ts [--match-min=8] [--tier=free|pro]
 *         [--egress-gb=5] [--per-match-kb=40] [--write-penalty=4] [--heap-gb=3]
 *         [--bw-mbps=500] [--ws-kb=30] [--overhead=4] [--per-msg-us=40] [--json]
 */
import os from "node:os";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ----------------------------------------------------------------------------
// Paramètres (CLI) — tout est explicite et ajustable, le modèle reste auditable.
// ----------------------------------------------------------------------------
const args = new Map(
	process.argv.slice(2).map((a) => {
		const [k, v] = a.replace(/^--/, "").split("=");
		return [k, v ?? "true"] as [string, string];
	})
);
const numArg = (k: string, def: number) => (args.has(k) ? Number(args.get(k)) : def);
const TIER = (args.get("tier") ?? "free") as "free" | "pro";
// Profils de plan Supabase (caps DURS documentés).
const TIERS = {
	free: { egressGb: 5, dbGb: 0.5, storageGb: 1, computeWriteTps: 0, pauseDays: 7 },
	pro: { egressGb: 250, dbGb: 8, storageGb: 100, computeWriteTps: 0, pauseDays: 0 },
}[TIER];
const P = {
	matchMin: numArg("match-min", 8), // durée moyenne d'un match (min) — W de Little
	bwMbps: numArg("bw-mbps", 500), // bande passante VPS (Mbit/s) pour le statique
	heapGb: numArg("heap-gb", 3), // budget heap RAISONNABLE d'UN process Bun (Go)
	wsKb: numArg("ws-kb", 30), // mémoire ~ par connexion WebSocket (Ko)
	overhead: numArg("overhead", 4), // facteur sur-coût room Colyseus vs objet nu
	perMsgUs: numArg("per-msg-us", 40), // µs CPU par message (event-loop + frame WS + syscall)
	egressGb: numArg("egress-gb", TIERS.egressGb), // egress mensuel du plan (Go)
	perMatchKb: numArg("per-match-kb", 40), // egress Supabase imputable à un match (Ko)
	writePenalty: numArg("write-penalty", 4), // coût d'une écriture vs une lecture triviale
	json: args.has("json"),
};

const BOT_ROOT = join(import.meta.dir, "..");
const CORE_ROOT = join(BOT_ROOT, "..", "..", "packages", "achillea-core");
const WEB_ROOT = join(BOT_ROOT, "..", "web");
const SECONDS_PER_MONTH = 30 * 86400;
const fmt = (n: number) =>
	n >= 1e6
		? `${(n / 1e6).toFixed(2)} M`
		: n >= 1e3
			? `${(n / 1e3).toFixed(1)} k`
			: `${Math.round(n)}`;
const readSrc = (rel: string) => {
	try {
		return readFileSync(join(BOT_ROOT, rel), "utf8");
	} catch {
		return "";
	}
};
const readCoreSrc = (rel: string) => {
	try {
		return readFileSync(join(CORE_ROOT, rel), "utf8");
	} catch {
		return "";
	}
};
const grabInt = (txt: string, re: RegExp, def: number) => {
	const m = txt.match(re);
	return m ? Number(m[1]) : def;
};
function bench(fn: () => void, iters: number): number {
	for (let i = 0; i < Math.min(iters, 5000); i++) fn();
	const t0 = process.hrtime.bigint();
	for (let i = 0; i < iters; i++) fn();
	return Number(process.hrtime.bigint() - t0) / iters;
}

// ----------------------------------------------------------------------------
// 1. HARDWARE
// ----------------------------------------------------------------------------
const cpus = os.cpus();
const cores = cpus.length;
const cpuModel = cpus[0]?.model.trim() ?? "?";
const totalRamGb = os.totalmem() / 2 ** 30;
const freeRamGb = os.freemem() / 2 ** 30;
const load1 = Number((readFileSync("/proc/loadavg", "utf8").split(" ")[0] ?? "0").trim());
let fdLimit = 524288;
try {
	fdLimit = grabInt(readFileSync("/proc/self/limits", "utf8"), /Max open files\s+(\d+)/, 524288);
} catch {
	/* non-linux */
}
const calStart = process.hrtime.bigint();
let acc = 0;
const CAL_ITERS = 20_000_000;
for (let i = 0; i < CAL_ITERS; i++) acc += Math.sqrt(i) * 1.0000001;
const opsPerSec = (CAL_ITERS / Number(process.hrtime.bigint() - calStart)) * 1e9;
if (acc < 0) console.log(acc);

// ----------------------------------------------------------------------------
// 2. CONFIG (extraite de la source)
// ----------------------------------------------------------------------------
const cfg = {
	lobbyMax: grabInt(readSrc("src/ranked/rooms/LobbyRoom.ts"), /maxClients\s*=\s*(\d+)/, 500),
	queueMax: grabInt(readSrc("src/ranked/rooms/QueueRoom.ts"), /maxClients\s*=\s*(\d+)/, 200),
	sqlMax: grabInt(readSrc("src/ranked/db.ts"), /BUN_SQL_MAX",\s*"(\d+)"/, 10),
	modes:
		readCoreSrc("src/ranked/index.ts").match(/SUPPORTED_MODES\s*=\s*\[([\d,\s]+)\]/)?.[1] ??
		"2, 4",
};

// ----------------------------------------------------------------------------
// 3. INVENTAIRE DES TESTS  (« en lisant tous nos tests »)
// ----------------------------------------------------------------------------
function walk(dir: string, out: string[] = []): string[] {
	if (!existsSync(dir)) return out;
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === "node_modules") continue;
		const p = join(dir, e.name);
		if (e.isDirectory()) walk(p, out);
		else if (/\.(test|spec)\.ts$/.test(e.name)) out.push(p);
	}
	return out;
}
const testFiles = [...walk(join(BOT_ROOT, "tests")), ...walk(join(WEB_ROOT, "src"))];
const tests = { files: testFiles.length, cases: 0, byCat: {} as Record<string, number> };
const rankedTexts: string[] = [];
for (const f of testFiles) {
	const txt = readFileSync(f, "utf8");
	tests.cases += (txt.match(/\b(test|it)\s*\(/g) ?? []).length;
	const cat = f.includes("/web/") ? "web" : (f.split("/tests/")[1]?.split("/")[0] ?? "misc");
	tests.byCat[cat] = (tests.byCat[cat] ?? 0) + 1;
	if (/ranked|elo|match/i.test(f)) rankedTexts.push(txt);
}
const stateFields = [
	"myScore",
	"oppScore",
	"startedMatch",
	"submitted",
	"proofUploaded",
	"confirmedFinish",
	"status",
	"disputeReason",
];
const blob = rankedTexts.join("\n");
const patchesObserved = stateFields.filter((f) => blob.includes(f)).length;
const N_PATCHES = Math.max(8, patchesObserved * 2);
const N_MESSAGES = Math.max(20, N_PATCHES + 12);
const N_ELO = 2;
const N_DB_QUERIES = 6; // fin de match : update elo×2 + insert history + ladder + season + lecture

// ----------------------------------------------------------------------------
// 4. MICRO-BENCHMARKS
// ----------------------------------------------------------------------------
let realFnNs = 0;
let realFnName = "(repli)";
try {
	const ml: any = await import("@rosegriffon/achillea-core");
	if (typeof ml.resolveScores === "function") {
		realFnName = "achillea-core.ranked.resolveScores";
		realFnNs = bench(
			() => ml.resolveScores({ myScore: 3, oppScore: 1 }, { myScore: 1, oppScore: 3 }, false),
			200_000
		);
	}
} catch {
	/* repli */
}
function eloDelta(ra: number, rb: number, sa: number, K = 32): number {
	return Math.round(K * (sa - 1 / (1 + 10 ** ((rb - ra) / 400))));
}
const eloNs = bench(() => {
	eloDelta(1200, 1350, 1);
	eloDelta(1350, 1200, 0);
}, 500_000);
function makeMatch(players: number) {
	return {
		roomCode: "A1B2C3",
		status: "playing",
		mode: players,
		ranked: true,
		lobbyId: 42,
		startedAt: Date.now(),
		disputeReason: "",
		players: Array.from({ length: players }, (_, i) => ({
			userId: "1234567890123456" + i,
			displayName: "JoueurNumero" + i,
			avatar: "abcdef0123456789abcdef0123456789",
			elo: 1200 + i * 37,
			team: i % 2,
			myScore: 3,
			oppScore: 1,
			startedMatch: true,
			submitted: true,
			proofUploaded: false,
			confirmedFinish: true,
		})),
		chat: Array.from({ length: 8 }, (_, i) => ({
			userId: "1234567890123456",
			text: "gg wp message numero " + i,
			at: Date.now(),
		})),
	};
}
const m2 = makeMatch(2);
const encodeNs = bench(() => {
	JSON.parse(JSON.stringify(m2));
}, 100_000);
const MEM_N = 20_000;
const before = process.memoryUsage().heapUsed;
const hold: unknown[] = new Array(MEM_N);
for (let i = 0; i < MEM_N; i++) hold[i] = makeMatch(2);
const bytesObj = Math.max(512, (process.memoryUsage().heapUsed - before) / MEM_N);
if (hold[0] === null) console.log("x");
const bytesPerRoom = bytesObj * P.overhead + 2 * P.wsKb * 1024;

// ----------------------------------------------------------------------------
// 5. SUPABASE — instance réelle + profil du plan
// ----------------------------------------------------------------------------
const db = {
	maxConn: 60,
	curConn: 16,
	sizeGb: 0,
	rttMs: 16,
	qpsAtPool: cfg.sqlMax * 60,
	measured: false,
	note: "repli",
};
try {
	const isProd = (process.env.NODE_ENV ?? "development") === "production";
	const host = process.env[isProd ? "DATABASE_HOST" : "DATABASE_HOST_DEV"] ?? "";
	if (host) {
		const sql = new Bun.SQL({
			host,
			port: Number(process.env[isProd ? "DATABASE_PORT" : "DATABASE_PORT_DEV"] ?? 5432),
			user: process.env[isProd ? "DATABASE_USER" : "DATABASE_USER_DEV"] ?? "postgres",
			password: process.env[isProd ? "DATABASE_PASSWORD" : "DATABASE_PASSWORD_DEV"] ?? "",
			database: process.env[isProd ? "DATABASE_NAME" : "DATABASE_NAME_DEV"] ?? "postgres",
			max: cfg.sqlMax,
			tls: host.includes("supabase") ? true : undefined,
			connect_timeout: 8,
		} as any);
		db.maxConn = Number((await sql`show max_connections`)[0].max_connections);
		db.curConn = Number((await sql`select count(*)::int n from pg_stat_activity`)[0].n);
		db.sizeGb =
			Number((await sql`select pg_database_size(current_database())::bigint b`)[0].b) / 2 ** 30;
		// latence à froid (1 conn) + débit soutenu à la concurrence = taille du pool applicatif.
		const lat: number[] = [];
		for (let i = 0; i < 12; i++) {
			const s = process.hrtime.bigint();
			await sql`select 1`;
			lat.push(Number(process.hrtime.bigint() - s) / 1e6);
		}
		lat.sort((a, b) => a - b);
		db.rttMs = lat[6];
		const N = 300,
			t0 = Bun.nanoseconds();
		let done = 0;
		await new Promise<void>((resolve) => {
			let inflight = 0,
				started = 0;
			const pump = () => {
				while (inflight < cfg.sqlMax && started < N) {
					inflight++;
					started++;
					sql`select 1`.then(() => {
						inflight--;
						done++;
						done === N ? resolve() : pump();
					});
				}
			};
			pump();
		});
		db.qpsAtPool = N / ((Bun.nanoseconds() - t0) / 1e9);
		db.measured = true;
		db.note = `mesuré (prod, pool=${cfg.sqlMax})`;
		await sql.end();
	}
} catch (e) {
	db.note = `non sondé (${(e as Error).message.slice(0, 50)})`;
}
const connHeadroom = db.maxConn - db.curConn;
// Débit de FINS de match : lectures triviales/s ÷ (requêtes/fin × pénalité écriture).
const matchEndsPerSec = db.qpsAtPool / (N_DB_QUERIES * P.writePenalty);

// ----------------------------------------------------------------------------
// 6. FRONTEND
// ----------------------------------------------------------------------------
function dirBytes(dir: string): number {
	if (!existsSync(dir)) return 0;
	let t = 0;
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		try {
			t += e.isDirectory() ? dirBytes(p) : statSync(p).size;
		} catch {
			/* skip */
		}
	}
	return t;
}
const distDir = existsSync("/var/www/achillea")
	? "/var/www/achillea"
	: join(WEB_ROOT, "dist/achillea-web/browser");
const bundleGzip = dirBytes(distDir) * 0.34;
const coldLoadsPerSec = (P.bwMbps * 1e6) / 8 / Math.max(1, bundleGzip);

// ----------------------------------------------------------------------------
// 7. MODÈLE — loi de Little L = λ·W (instantané) + plafonds mensuels (egress).
// ----------------------------------------------------------------------------
const W = P.matchMin * 60;
const cpuUsPerMatch =
	N_ELO * (eloNs / 1000) +
	N_PATCHES * (encodeNs / 1000) +
	N_MESSAGES * P.perMsgUs +
	(realFnNs / 1000) * N_PATCHES;
const lambdaCpu = 1e6 / cpuUsPerMatch;
const L_cpu = lambdaCpu * W;
const L_ram = (P.heapGb * 2 ** 30) / bytesPerRoom;
const L_db = matchEndsPerSec * W; // compute Supabase (écritures de fin de match)
const L_ws = fdLimit / 2;
const dims = [
	{
		k: "RAM (1 process)",
		L: L_ram,
		note: `${(bytesPerRoom / 1024).toFixed(0)} Ko/room × ${P.heapGb} Go`,
	},
	{
		k: "CPU (1 thread)",
		L: L_cpu,
		note: `${cpuUsPerMatch.toFixed(0)} µs/match → λ=${fmt(lambdaCpu)}/s`,
	},
	{
		k: "Supabase compute",
		L: L_db,
		note: `${fmt(db.qpsAtPool)} req/s ÷ (${N_DB_QUERIES}×${P.writePenalty}) → ${matchEndsPerSec.toFixed(0)} fins/s`,
	},
	{ k: "WebSocket / FD", L: L_ws, note: `FD ${fmt(fdLimit)} ÷ 2` },
];
const binding = dims.reduce((a, b) => (b.L < a.L ? b : a));
// EGRESS — plafond MENSUEL (volume), pas de la concurrence instantanée.
const egressBytes = P.egressGb * 1e9;
const matchesPerMonth = egressBytes / (P.perMatchKb * 1024);
const matchesPerDay = matchesPerMonth / 30;
const egressSustained = (matchesPerMonth / SECONDS_PER_MONTH) * W; // concurrence si étalé 24/7

// ----------------------------------------------------------------------------
// SORTIE
// ----------------------------------------------------------------------------
if (P.json) {
	console.log(
		JSON.stringify(
			{
				tier: TIER,
				hardware: { cores, cpuModel, totalRamGb, fdLimit, opsPerSec },
				cfg,
				tests,
				bench: { realFnName, realFnNs, eloNs, encodeNs, bytesPerRoom },
				db: { ...db, connHeadroom, matchEndsPerSec },
				model: { W, dims, binding: binding.k, concurrent: Math.round(binding.L) },
				egress: {
					egressGb: P.egressGb,
					perMatchKb: P.perMatchKb,
					matchesPerMonth: Math.round(matchesPerMonth),
					matchesPerDay: Math.round(matchesPerDay),
					egressSustained: Math.round(egressSustained),
				},
			},
			null,
			2
		)
	);
	process.exit(0);
}
const line = "─".repeat(76);
const row = (a: string, b: string) => `  ${a.padEnd(32)} ${b}`;
console.log(
	`\n${line}\n  ESTIMATION DE CAPACITÉ — MATCHS RANKED SIMULTANÉS  (plan Supabase: ${TIER.toUpperCase()})\n${line}`
);
console.log("\n▸ HARDWARE");
console.log(row("CPU", `${cores} vCPU — ${cpuModel}`));
console.log(
	row(
		"RAM",
		`${totalRamGb.toFixed(0)} Go (${freeRamGb.toFixed(1)} libre), charge ${load1.toFixed(2)}/${cores}`
	)
);
console.log(row("Limite FD (process)", fmt(fdLimit)));
console.log("\n▸ CONFIG (lue dans le code)");
console.log(row("Lobby / Queue maxClients", `${cfg.lobbyMax} / ${cfg.queueMax}`));
console.log(row("Pool Bun.SQL", `${cfg.sqlMax}   • modes [${cfg.modes}]`));
console.log("\n▸ TESTS (inventaire complet)");
console.log(row("Fichiers / cas", `${tests.files} / ${tests.cases}`));
console.log(
	row(
		"Catégories",
		Object.entries(tests.byCat)
			.map(([k, v]) => `${k}:${v}`)
			.join("  ")
	)
);
console.log("\n▸ MICRO-BENCHMARKS (mesurés)");
console.log(
	row(
		realFnName,
		`${realFnNs.toFixed(0)} ns   • Elo ${eloNs.toFixed(0)} ns   • encode ${encodeNs.toFixed(0)} ns`
	)
);
console.log(row("Mémoire / room (2 j.)", `${(bytesPerRoom / 1024).toFixed(0)} Ko`));
console.log(`\n▸ SUPABASE ${TIER.toUpperCase()} (instance réelle sondée)`);
console.log(
	row("max_connections", `${db.maxConn}  (${db.curConn} utilisées → ${connHeadroom} libres)`)
);
console.log(
	row(
		"Taille DB",
		`${(db.sizeGb * 1024).toFixed(0)} Mo / ${(TIERS.dbGb * 1024).toFixed(0)} Mo (cap plan)`
	)
);
console.log(row("Latence (1 conn)", `${db.rttMs.toFixed(1)} ms`));
console.log(row("Débit mesuré (pool)", `${fmt(db.qpsAtPool)} req/s — ${db.note}`));
console.log(
	row("→ fins de match/s", `${matchEndsPerSec.toFixed(0)} (pénalité écriture ×${P.writePenalty})`)
);
console.log(`\n▸ MODÈLE INSTANTANÉ — loi de Little  L = λ·W   (W = ${P.matchMin} min)`);
for (const d of dims)
	console.log(
		`  ${d.k.padEnd(20)} ${fmt(d.L).padStart(12)}   ${d.note} ${d === binding ? "◀ LIANTE" : ""}`
	);
const concurrent = Math.round(binding.L);
console.log(`\n▸ EGRESS — PLAFOND MENSUEL (le vrai mur d'un plan ${TIER})`);
console.log(row("Budget", `${P.egressGb} Go/mois  •  ~${P.perMatchKb} Ko/match (hyp.)`));
console.log(
	row("Volume max", `~${fmt(matchesPerMonth)} matchs/mois  ≈ ${fmt(matchesPerDay)}/jour`)
);
console.log(row("Si étalé 24/7", `~${fmt(egressSustained)} matchs simultanés soutenus`));
console.log(`\n${line}`);
console.log(`  ➤ INSTANTANÉ   : ~${fmt(concurrent)} matchs simultanés  (liante: ${binding.k})`);
console.log(
	`  ➤ MENSUEL      : ~${fmt(matchesPerMonth)} matchs/mois plafonnés par l'egress ${P.egressGb} Go`
);
console.log(
	`  ➤ MUR CONFIG   : lobby ${cfg.lobbyMax} joueurs ; connexions DB ${db.maxConn} (${connHeadroom} libres)`
);
console.log(`  ➤ AVAILABILITY : projet free en PAUSE après ${TIERS.pauseDays} j d'inactivité`);
console.log(line);
console.log("\n▸ CE QUI CASSE EN PREMIER (plan free, par ordre réaliste)");
console.log(
	`  1. EGRESS 5 Go/mois → ~${fmt(matchesPerDay)} matchs/jour (le vrai plafond d'usage public).`
);
console.log(
	`  2. CONNEXIONS 60 (${connHeadroom} libres) — bot pools + lectures directes SPA partagent.`
);
console.log("  3. Compute Nano (CPU/RAM partagés) → latence d'écriture qui grimpe sous charge.");
console.log("  4. Stockage 1 Go (captures de litige) ; DB 500 Mo.");
console.log("\n▸ LEVIERS");
console.log(
	"  • Passer Pro (egress 250 Go, compute dédié, +connexions, pas de pause) si ça décolle."
);
console.log(
	"  • Garder le leaderboard/dashboard derrière l'API du bot (cache) — pas de lecture Supabase directe lourde."
);
console.log(
	`  • Relever lobby/queue maxClients ; BUN_SQL_MAX ${cfg.sqlMax}→ tant que somme des pools < ${db.maxConn}.\n`
);
process.exit(0);
