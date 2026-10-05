#!/usr/bin/env bun
/**
 * Traduit en français, avec le moteur Aphrody, les fiches `sources-collectees/*`
 * dont le corps est resté en anglais (Kanzenshuu, jimaku.cc, sites officiels).
 *
 * Trois étapes, chacune rejouable :
 *
 *   selectionner  lit PostgreSQL, garde les fiches non encore traduites dont
 *                 titre + extrait sont en anglais, écrit `candidats.jsonl` dans
 *                 le dossier de travail.
 *   traduire      envoie le lot sur l'hôte applicatif (ssh `vps`, dossier /tmp),
 *                 y lance `_aphrody-translate-remote.ts` détaché (ré-extraction
 *                 du contenu principal via Aphrody Web, traduction EN→FR via
 *                 `aphrody translate -b bxc`), attend la fin et rapatrie
 *                 `resultats.jsonl`. Relancé, il reprend où il s'était arrêté.
 *   appliquer     réécrit chaque fiche (titre français, « Titre original »,
 *                 Provenance et Classement éditorial intacts, extrait original +
 *                 traduction, ou description neutre à défaut d'extrait) par lots
 *                 transactionnels : UPDATE … WHERE id = $1 AND body = $ancien
 *                 AND title = $ancien, une révision `public.wiki_revisions` par
 *                 fiche réellement modifiée (même instruction, via CTE).
 *
 * Accès base : `ssh dbfr` + `psql` (SQL sur stdin, une transaction par appel) ;
 * le tunnel local 127.0.0.1:5432 cale sur les gros volumes. Les valeurs sont
 * passées en littéraux dollar-quotés, `before`/`after` construits par
 * `jsonb_build_object` (jamais une chaîne JSON).
 *
 * Une traduction identique à la source (échec silencieux du backend) n'est
 * jamais écrite : la fiche est laissée telle quelle et comptée à part.
 *
 * Usage (depuis la racine du dépôt) :
 *   bun apps/shenron/site/scripts/traduire-pages-collectees-aphrody.ts selectionner --travail <dossier>
 *   bun apps/shenron/site/scripts/traduire-pages-collectees-aphrody.ts traduire --travail <dossier> [--concurrence 4]
 *   bun apps/shenron/site/scripts/traduire-pages-collectees-aphrody.ts appliquer --travail <dossier> [--lot 50]
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RemoteInput, RemoteOutput } from "./_aphrody-translate-remote";
import {
	type TranslatedPage,
	decodeEntities,
	isTranslatedBody,
	isTranslationCandidate,
	neutralDescription,
	originUrl,
	renderTranslatedBody,
} from "./_collected-page-translation";

const EDITOR_ID = "shenron-traduction-aphrody";
const EDITOR_NAME = "Shenron — traduction Aphrody";
const REVISION_LABEL = "Traduction française automatique (moteur Aphrody) d'une source collectée";
const REMOTE_HOST = "vps";
const REMOTE_DIR = "/tmp/shenron-traduction-pages-collectees";
const REMOTE_TOKEN_FILE = "/etc/aphrody/aphrody-web-api.env";
const DB_HOST = "dbfr";
const PSQL = "sudo -n -u postgres psql -d shenron_site -X -A -t -q -v ON_ERROR_STOP=1 --single-transaction";

const argv = process.argv.slice(2);
const command = argv[0];
function optionValue(name: string): string | undefined {
	const index = argv.indexOf(name);
	return index === -1 ? undefined : argv[index + 1];
}
function integerOption(name: string, fallback: number, min: number, max: number): number {
	const raw = optionValue(name);
	if (raw === undefined) return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} attend un entier de ${min} à ${max}.`);
	return value;
}

const workDir = resolve(optionValue("--travail") ?? join(tmpdir(), "shenron-traduction-pages-collectees"));
const CANDIDATES = join(workDir, "candidats.jsonl");
const RESULTS = join(workDir, "resultats.jsonl");
const scriptsDir = fileURLToPath(new URL(".", import.meta.url));

function readJsonl<T>(path: string): T[] {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim())
		.flatMap((line) => {
			try {
				return [JSON.parse(line) as T];
			} catch {
				return [];
			}
		});
}

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return "?";
	}
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
	const out: Record<string, number> = {};
	for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
	return Object.fromEntries(Object.entries(out).toSorted((a, b) => b[1] - a[1]));
}

async function run(cmd: string[], cwd: string, input?: string): Promise<string> {
	const child = Bun.spawn(cmd, { cwd, stdin: input === undefined ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	if (code !== 0) throw new Error(`${cmd[0]} a échoué (${code}) : ${stderr.trim().slice(0, 600)}`);
	return stdout;
}

// ── PostgreSQL via ssh + psql ───────────────────────────────────────────────────

/** Runs SQL (stdin) on the database host in one transaction; retries ssh-level failures (exit 255) only. */
async function psql(sqlText: string, label: string, attempts = 8): Promise<string[]> {
	for (let attempt = 1; ; attempt++) {
		const child = Bun.spawn(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "-o", "ServerAliveInterval=30", DB_HOST, PSQL], {
			stdin: new Blob([sqlText]),
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
		if (code === 0) return stdout.split("\n").filter((line) => line.length > 0);
		if (code !== 255 || attempt >= attempts) throw new Error(`${label} : psql a échoué (${code}) : ${stderr.trim().slice(0, 600)}`);
		console.error(`[reprise] ${label} : ssh ${code}, tentative ${attempt + 1}/${attempts}`);
		await Bun.sleep(2_000 * attempt);
	}
}

/** Dollar-quoted SQL literal whose tag never occurs in the value. */
export function dollarQuote(value: string): string {
	let tag = "q";
	while (value.includes(`$${tag}$`)) tag = `q${Math.random().toString(36).slice(2, 10)}`;
	return `$${tag}$${value}$${tag}$`;
}

// ── selectionner ────────────────────────────────────────────────────────────────

/** `excerptPart`: the body from its `## Extrait collecté` heading on (empty once rewritten), enough for the language test. */
type CandidateRow = { id: string; title: string; category: string; url: string | null; excerptPart: string | null };

async function select(): Promise<void> {
	mkdirSync(workDir, { recursive: true });
	const lines = await psql(
		String.raw`SELECT json_build_object(
			'id', p.id, 'title', p.title, 'category', c.slug,
			'url', substring(p.body from '- \*\*Document d''origine :\*\* (\S+)'),
			'excerptPart', substring(p.body from position('## Extrait collecté' in p.body))
		)::text
		FROM public."WikiPage" p
		JOIN public."WikiCategory" c ON c.id = p."categoryId"
		WHERE c.slug LIKE 'sources-collectees/%';`,
		"lecture des fiches",
	);
	const rows = lines.map((line) => JSON.parse(line) as CandidateRow);
	const reasons: Record<string, number> = {};
	const candidates = rows.filter((row) => {
		const verdict = row.url ? isTranslationCandidate(row.title, row.excerptPart ?? "", row.url) : { ok: false as const, reason: "sans document d'origine" };
		if (!verdict.ok) reasons[verdict.reason] = (reasons[verdict.reason] ?? 0) + 1;
		return verdict.ok;
	});
	const out = candidates.map((row) => JSON.stringify({ id: row.id, url: row.url ?? "", title: row.title } satisfies RemoteInput));
	writeFileSync(CANDIDATES, out.length ? `${out.join("\n")}\n` : "");
	console.log(
		JSON.stringify(
			{
				fiches: rows.length,
				ecartees: Object.fromEntries(Object.entries(reasons).toSorted((a, b) => b[1] - a[1])),
				candidats: candidates.length,
				parHote: countBy(candidates, (row) => hostOf(row.url ?? "")),
				parRubrique: countBy(candidates, (row) => row.category),
				fichier: CANDIDATES,
			},
			null,
			2,
		),
	);
}

// ── traduire (sur l'hôte applicatif) ────────────────────────────────────────────

const SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "-o", "ServerAliveInterval=30", REMOTE_HOST];
const SCP = ["scp", "-q", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20"];

async function translateRemote(): Promise<void> {
	if (!existsSync(CANDIDATES)) throw new Error(`Lancer d'abord « selectionner » (${CANDIDATES} absent).`);
	const concurrency = integerOption("--concurrence", 4, 1, 12);
	await run([...SSH, `mkdir -p ${REMOTE_DIR}`], workDir);
	// Relative paths: scp reads `C:\…` as a host name.
	await run([...SCP, "_collected-page-translation.ts", "_aphrody-translate-remote.ts", `${REMOTE_HOST}:${REMOTE_DIR}/`], scriptsDir);
	await run([...SCP, "candidats.jsonl", `${REMOTE_HOST}:${REMOTE_DIR}/candidats.jsonl`], workDir);
	// The token is read into a variable on the host and never leaves it.
	const launch = [
		"set -e",
		`cd ${REMOTE_DIR}`,
		"rm -f resultats.jsonl.done",
		`BXC_API_TOKEN="$(sudo -n sed -n 's/^BXC_API_TOKEN=//p' ${REMOTE_TOKEN_FILE} | tr -d "\\"'")"`,
		"export BXC_API_TOKEN",
		`nohup "$HOME/.bun/bin/bun" _aphrody-translate-remote.ts --entree candidats.jsonl --sortie resultats.jsonl --concurrence ${concurrency} >> run.log 2>&1 < /dev/null &`,
		"echo lancé",
	].join("\n");
	console.log((await run([...SSH, "bash -s"], workDir, launch)).trim());
	const total = readJsonl<RemoteInput>(CANDIDATES).length;
	for (;;) {
		await Bun.sleep(30_000);
		const state = await run(
			[...SSH, `cd ${REMOTE_DIR} && (test -f resultats.jsonl && wc -l < resultats.jsonl || echo 0) && (test -f resultats.jsonl.done && echo fini || echo encours)`],
			workDir,
		).catch((error: unknown) => `? ${error instanceof Error ? error.message : String(error)}`);
		const [count = "?", status = "?"] = state.trim().split("\n");
		console.log(`[traduire] ${count.trim()}/${total} ${status.trim()}`);
		if (status.trim() === "fini") break;
	}
	await run([...SCP, `${REMOTE_HOST}:${REMOTE_DIR}/resultats.jsonl`, "resultats.jsonl"], workDir);
	summarizeResults();
}

function summarizeResults(): void {
	const results = readJsonl<RemoteOutput>(RESULTS);
	const failure = (check: RemoteOutput["titleCheck"] | null) => (check && !check.ok ? check.reason : "");
	console.log(
		JSON.stringify(
			{
				resultats: results.length,
				titresOk: results.filter((row) => row.titleCheck.ok).length,
				extraits: countBy(results, (row) => (row.scrape.startsWith("error") ? "error" : row.scrape)),
				extraitsTraduits: results.filter((row) => row.excerptCheck?.ok).length,
				echecsTitre: countBy(results.filter((row) => !row.titleCheck.ok), (row) => failure(row.titleCheck)),
				echecsExtrait: countBy(results.filter((row) => row.excerptCheck && !row.excerptCheck.ok), (row) => failure(row.excerptCheck)),
			},
			null,
			2,
		),
	);
}

// ── appliquer ───────────────────────────────────────────────────────────────────

type PageRow = { id: string; title: string; body: string };
type Plan = { row: PageRow; title: string; body: string; mode: "extrait" | "titre" };

/** The rewrite of one page, or the reason it is left untouched. */
export function planPage(row: PageRow, result: RemoteOutput): Plan | { skip: string } {
	if (isTranslatedBody(row.body)) return { skip: "déjà traduite" };
	if (!result.titleCheck.ok || !result.frenchTitle) return { skip: "titre non traduit" };
	const url = originUrl(row.body);
	if (!url) return { skip: "sans document d'origine" };
	const frenchTitle = decodeEntities(result.frenchTitle).replace(/\s+/g, " ").trim();
	const withExcerpt = Boolean(result.excerpt && result.translation && result.excerptCheck?.ok);
	const reason = result.scrape === "skipped" ? "list" : result.scrape.startsWith("error") ? "unreadable" : "empty";
	const page: TranslatedPage = {
		frenchTitle,
		originalTitle: result.originalTitle || decodeEntities(row.title),
		excerpt: withExcerpt ? result.excerpt : "",
		translation: withExcerpt ? result.translation : "",
		description: withExcerpt ? "" : neutralDescription(url, frenchTitle, reason),
	};
	return { row, title: frenchTitle, body: renderTranslatedBody(row.body, page), mode: withExcerpt ? "extrait" : "titre" };
}

function updateStatement(plan: Plan): string {
	const before = `jsonb_build_object('title', ${dollarQuote(plan.row.title)}, 'body', ${dollarQuote(plan.row.body)})`;
	const after = `jsonb_build_object('title', ${dollarQuote(plan.title)}, 'body', ${dollarQuote(plan.body)})`;
	return `WITH u AS (
	UPDATE public."WikiPage" SET title = ${dollarQuote(plan.title)}, body = ${dollarQuote(plan.body)}, "updatedAt" = now()
	WHERE id = ${dollarQuote(plan.row.id)} AND body = ${dollarQuote(plan.row.body)} AND title = ${dollarQuote(plan.row.title)}
	RETURNING id
)
INSERT INTO public.wiki_revisions (id, "tableName", "rowId", action, label, before, after, "editorId", "editorName")
SELECT ${dollarQuote(randomUUID())}, 'WikiPage', u.id, 'update', ${dollarQuote(REVISION_LABEL)}, ${before}, ${after}, ${dollarQuote(EDITOR_ID)}, ${dollarQuote(EDITOR_NAME)}
FROM u
RETURNING 'ecrit:' || "rowId";`;
}

async function apply(): Promise<void> {
	if (!existsSync(RESULTS)) throw new Error(`Lancer d'abord « traduire » (${RESULTS} absent).`);
	const batchSize = integerOption("--lot", 50, 1, 500);
	const results = new Map(readJsonl<RemoteOutput>(RESULTS).map((row) => [row.id, row]));
	const ids = [...results.keys()];
	const rows: PageRow[] = [];
	for (let start = 0; start < ids.length; start += 500) {
		const list = ids.slice(start, start + 500).map(dollarQuote).join(", ");
		const lines = await psql(
			`SELECT json_build_object('id', id, 'title', title, 'body', body)::text FROM public."WikiPage" WHERE id IN (${list});`,
			"lecture des fiches ciblées",
		);
		rows.push(...lines.map((line) => JSON.parse(line) as PageRow));
	}
	const counts = { resultats: results.size, planifiees: 0, ecrites: 0, avecExtrait: 0, titreSeul: 0, conflits: 0, ignorees: {} as Record<string, number> };
	const plans: Plan[] = [];
	for (const row of rows) {
		const result = results.get(row.id);
		if (!result) continue;
		const plan = planPage(row, result);
		if ("skip" in plan) counts.ignorees[plan.skip] = (counts.ignorees[plan.skip] ?? 0) + 1;
		else plans.push(plan);
	}
	if (ids.length > rows.length) counts.ignorees["absente de la base"] = ids.length - rows.length;
	counts.planifiees = plans.length;
	const written: Plan[] = [];
	for (let start = 0; start < plans.length; start += batchSize) {
		const batch = plans.slice(start, start + batchSize);
		const output = await psql(batch.map(updateStatement).join("\n"), `lot ${start / batchSize + 1}`);
		const ok = new Set(output.filter((line) => line.startsWith("ecrit:")).map((line) => line.slice("ecrit:".length)));
		const done = batch.filter((plan) => ok.has(plan.row.id));
		written.push(...done);
		counts.conflits += batch.length - done.length;
		console.log(`[appliquer] lot ${start / batchSize + 1}/${Math.ceil(plans.length / batchSize)} : ${done.length}/${batch.length} écrites`);
	}
	counts.ecrites = written.length;
	counts.avecExtrait = written.filter((plan) => plan.mode === "extrait").length;
	counts.titreSeul = written.length - counts.avecExtrait;
	const [check] = await psql(
		`SELECT json_build_object('revisions', count(*), 'jsonChaine', count(*) FILTER (WHERE jsonb_typeof(before) = 'string' OR jsonb_typeof(after) = 'string'))::text
		FROM public.wiki_revisions WHERE "editorId" = ${dollarQuote(EDITOR_ID)};`,
		"contrôle des révisions",
	);
	const examples = spread(written.filter((plan) => plan.mode === "extrait"), 4)
		.concat(written.filter((plan) => plan.mode === "titre").slice(0, 1))
		.map((plan) => ({ id: plan.row.id, avant: plan.row.title, apres: plan.title, mode: plan.mode }));
	writeFileSync(join(workDir, "ecrites.jsonl"), written.map((plan) => JSON.stringify({ id: plan.row.id, title: plan.title, mode: plan.mode })).join("\n"));
	console.log(JSON.stringify({ ...counts, controle: check ? JSON.parse(check) : null, exemples: examples }, null, 2));
}

/** `count` items spread evenly over the list (stable review sample). */
function spread<T>(items: T[], count: number): T[] {
	if (items.length <= count) return items;
	return Array.from({ length: count }, (_, index) => items[Math.floor((index * items.length) / count)] as T);
}

if (import.meta.main) {
	if (command === "selectionner") await select();
	else if (command === "traduire") await translateRemote();
	else if (command === "appliquer") await apply();
	else if (command === "bilan") summarizeResults();
	else {
		console.error("Usage : traduire-pages-collectees-aphrody.ts selectionner|traduire|bilan|appliquer --travail <dossier>");
		process.exit(2);
	}
}
