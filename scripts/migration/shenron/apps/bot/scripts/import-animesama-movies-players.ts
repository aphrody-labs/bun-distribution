#!/usr/bin/env bun
import { homePath, userHome } from "@aphrody/paths";
/**
 * import-animesama-movies-players.ts — Lecteurs anime-sama pour les films qui
 * n'en ont aucun dans une langue.
 *
 * Constat du 2026-09-13 : 5 films sur 28 sans aucun lecteur (dont les téléfilms
 * « Bardock, le père de Goku » et « L'Histoire de Trunks »), d'autres sans VF ou
 * sans VOSTFR. voir-anime, source de `import-voiranime-movies-players.ts`, n'a
 * pas ces entrées ; anime-sama publie une saison « film » par série, en VF et en
 * VOSTFR.
 *
 * Appariement par titre, sans approximation : titre anime-sama et titre de la
 * fiche doivent être égaux après normalisation (casse, accents, ponctuation) et
 * retrait du préfixe « Dragon Ball [Z|GT|Super] ». Un titre sans égal unique est
 * journalisé et laissé de côté — « Bardock vs Freezer » ne devient pas
 * « Episode of Bardock » par ressemblance.
 *
 * Chaque embed est résolu par `bxc animesama resolve` avant d'être gardé : seul
 * un lecteur qui rend un flux entre en base (mesuré le 2026-09-13 : sendvid 502,
 * myvi sans réponse, sibnet et ansembed jouables).
 *
 * N'ajoute que dans une langue où la fiche n'a AUCUN lecteur : les lecteurs
 * existants ne sont ni réordonnés ni remplacés.
 *
 * Écrit `bot.db_movies.players` (jsonb, Postgres seulement).
 * SIMULATION PAR DÉFAUT — `--appliquer` pour écrire. Env : DATABASE_URL.
 */
import { join } from "node:path";
import postgres from "postgres";

const BXC_BIN =
	process.env.BXC_BIN ||
	Bun.which("bxc") ||
	(await Bun.file(homePath(".local", "bin", "bxc")).exists() ? homePath(".local", "bin", "bxc") : null);
const BXC_CLI = process.env.BXC_CLI ?? join(userHome(), "bxc/src/cli/index.ts");
const SLUGS = ["dragon-ball", "dragon-ball-z", "dragon-ball-gt", "dragon-ball-super"];
const LANGUES = ["vf", "vostfr"] as const;
const APPLIQUER = process.argv.includes("--appliquer");

type Langue = (typeof LANGUES)[number];
type Lecteur = { lang?: string; name?: string; embedUrl?: string; provider?: string };
type Offre = { hebergeur: string; url: string };

async function bxc(argv: string[]): Promise<unknown> {
	const cmd = BXC_BIN ? [BXC_BIN, ...argv] : [process.execPath, BXC_CLI, ...argv];
	const proc = Bun.spawn(cmd, {
		cwd: BXC_BIN ? undefined : join(BXC_CLI, "../../.."),
		env: {
			...process.env,
			HTTPS_PROXY: "",
			HTTP_PROXY: "",
			ALL_PROXY: "",
			https_proxy: "",
			http_proxy: "",
			all_proxy: "",
		},
		stdout: "pipe",
		stderr: "ignore",
	});
	const minuterie = setTimeout(() => proc.kill(), 120_000);
	const sortie = await new Response(proc.stdout).text();
	await proc.exited;
	clearTimeout(minuterie);
	try {
		return JSON.parse(sortie.slice(Math.max(0, sortie.indexOf("{"))));
	} catch {
		return null;
	}
}

const cle = (titre: string) =>
	titre
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.replace(/^dragon ball(?: z| gt| super)?\s+/, "");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL requis");
const sql = postgres(url, { max: 1 });

try {
	const films = await sql<{ id: number; title: string; players: Lecteur[] | null }[]>`
		select id, title, players from bot.db_movies order by id`;
	const parCle = new Map<string, number[]>();
	for (const f of films) parCle.set(cle(f.title), [...(parCle.get(cle(f.title)) ?? []), Number(f.id)]);

	const offres = new Map<number, Map<Langue, Offre[]>>();
	const sansEgal = new Set<string>();
	for (const slug of SLUGS) {
		for (const langue of LANGUES) {
			const rep = (await bxc(["animesama", "episodes", slug, "--season", "film", "--lang", langue, "--json"])) as {
				episodes?: { nom: string; lecteurs: Offre[] }[];
			} | null;
			if (!rep?.episodes) {
				console.log(`  ✗ anime-sama ${slug}/film/${langue} : réponse illisible`);
				continue;
			}
			for (const e of rep.episodes) {
				const ids = parCle.get(cle(e.nom)) ?? [];
				if (ids.length !== 1) {
					sansEgal.add(`${e.nom} (${slug}${ids.length > 1 ? `, ${ids.length} fiches` : ""})`);
					continue;
				}
				const parLangue = offres.get(ids[0]) ?? new Map<Langue, Offre[]>();
				parLangue.set(langue, [...(parLangue.get(langue) ?? []), ...e.lecteurs]);
				offres.set(ids[0], parLangue);
			}
		}
	}
	if (sansEgal.size) console.log(`sans fiche au titre identique : ${[...sansEgal].join(" · ")}`);

	let ajoutes = 0;
	let fiches = 0;
	let sansFlux = 0;
	for (const f of films) {
		const existants = f.players ?? [];
		const nouveaux: Lecteur[] = [];
		for (const langue of LANGUES) {
			if (existants.some((p) => p.lang === langue)) continue;
			for (const o of offres.get(Number(f.id))?.get(langue) ?? []) {
				if ([...existants, ...nouveaux].some((p) => p.embedUrl === o.url)) continue;
				const flux = (await bxc(["animesama", "resolve", o.url, "--json"])) as { url?: string | null } | null;
				if (!flux?.url) {
					console.log(`  ✗ film ${f.id} ${langue} ${o.hebergeur} : aucun flux (${o.url})`);
					sansFlux++;
					continue;
				}
				nouveaux.push({ lang: langue, name: `${langue.toUpperCase()} · ${o.hebergeur}`, embedUrl: o.url, provider: o.hebergeur });
			}
		}
		if (!nouveaux.length) continue;
		fiches++;
		ajoutes += nouveaux.length;
		console.log(`  ${APPLIQUER ? "✓" : "·"} film ${f.id} « ${f.title} » : + ${nouveaux.map((p) => p.name).join(", ")}`);
		if (APPLIQUER) {
			await sql`update bot.db_movies set players = ${sql.json([...existants, ...nouveaux] as never)} where id = ${f.id}`;
		}
	}
	console.log(
		`\n${ajoutes} lecteur(s) ${APPLIQUER ? "ajouté(s)" : "à ajouter"} sur ${fiches} film(s) · ${sansFlux} embed(s) sans flux écarté(s)`
	);
} finally {
	await sql.end({ timeout: 5 });
}
