#!/usr/bin/env bun
/**
 * Reconstruit l'index Redis des databooks depuis Postgres — fiches ET
 * transcriptions des planches (`dbfr:databook:<id>:textes`).
 *
 * L'index (`lib/databooks-redis.ts`) est tenu à jour à chaque écriture passant
 * par l'API. Ce script sert au premier remplissage et à la réparation après une
 * perte de Redis ou une écriture directe en base.
 *
 * Usage (l'env doit porter DATABASE_URL) :
 *   bun scripts/index-databooks-redis.ts
 *   bun scripts/index-databooks-redis.ts --purge   # vide l'index avant
 */
import postgres from "postgres";
import { RedisClient } from "bun";
import { resolveRedisUrl } from "@shenron/config/services";
import { transcriptionsDe } from "../src/lib/databooks-index-shared";

const DB_INDEX = 4;
const PREFIXE = "dbfr:databook";
const PURGE = process.argv.includes("--purge");

async function getDatabaseUrl(): Promise<string> {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const envFile = Bun.file(new URL("../.env", import.meta.url));
	const text = await envFile.text().catch(() => "");
	const valeur = text
		.split(/\r?\n/)
		.filter((l) => l.startsWith("DATABASE_URL="))
		.at(-1)
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) throw new Error("DATABASE_URL introuvable");
	return valeur;
}

const url = await getDatabaseUrl();

const sql = postgres(url, { max: 2 });
const redisUrl = new URL(resolveRedisUrl(process.env));
redisUrl.pathname = `/${DB_INDEX}`;
const redis = new RedisClient(redisUrl.toString(), { autoReconnect: true, maxRetries: 20 });

if (PURGE) {
	// SCAN plutôt que KEYS : KEYS bloque le serveur, et db0 porte 1,1 M de clés.
	let curseur = "0";
	let supprimees = 0;
	do {
		const [suivant, cles] = (await redis.send("SCAN", [
			curseur,
			"MATCH",
			`${PREFIXE}*`,
			"COUNT",
			"500",
		])) as [string, string[]];
		curseur = suivant;
		for (const c of cles) {
			await redis.del(c);
			supprimees++;
		}
	} while (curseur !== "0");
	console.log(`  purge : ${supprimees} clé(s) retirée(s)`);
}

const rows = await sql<
	{
		id: string;
		kind: string;
		title: string;
		title_ja: string | null;
		author: string | null;
		published_at: string | null;
		cover: string | null;
		description: string | null;
		category: string | null;
		pages: unknown;
	}[]
>`select id, kind, title, title_ja, author, published_at, cover, description, category, pages
  from bot.db_databooks where visible order by id`;

let indexees = 0;
let planches = 0;
for (const r of rows) {
	const id = Number(r.id);
	const pages = Array.isArray(r.pages) ? r.pages : [];
	const etat = transcriptionsDe(pages);
	await redis.set(
		`${PREFIXE}:${id}`,
		JSON.stringify({
			id,
			kind: r.kind,
			title: r.title,
			title_ja: r.title_ja,
			author: r.author,
			published_at: r.published_at === null ? null : Number(r.published_at),
			cover: r.cover,
			description: r.description,
			category: r.category,
			pageCount: pages.length,
			transcrites: etat.transcrites,
			traduites: etat.traduites,
			fautives: etat.fautives,
		})
	);
	// Les transcriptions, une planche par champ : c'est ce qui permet à la fiche
	// publique de servir un lot de planches sans rapatrier la colonne `pages`
	// entière depuis Postgres (8 Mo pour 370 ouvrages).
	await redis.del(`${PREFIXE}:${id}:textes`);
	for (let i = 0; i < etat.champs.length; i += 200) {
		await redis.send("HSET", [`${PREFIXE}:${id}:textes`, ...etat.champs.slice(i, i + 200)]);
	}
	planches += etat.transcrites;
	await redis.sadd(`${PREFIXE}s:all`, String(id));
	await redis.sadd(`${PREFIXE}s:kind:${r.kind}`, String(id));
	if (r.category) await redis.sadd(`${PREFIXE}s:category:${r.category}`, String(id));
	indexees++;
}

const total = await redis.scard(`${PREFIXE}s:all`);
console.log(
	`✓ ${indexees} fiche(s) et ${planches} transcription(s) indexées — ${total} fiches au total ` +
		`dans l'index (Redis db${DB_INDEX})`
);
await sql.end();
process.exit(0);
