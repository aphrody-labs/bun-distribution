#!/usr/bin/env bun
import { userHome } from "@aphrody/paths";
/**
 * images-attribution.ts — d'où vient vraiment l'image d'une fiche d'épisode ?
 *
 * 736 fiches d'épisode portent une vignette, et rien ne dit qu'elle montre bien
 * l'épisode annoncé : ces images viennent d'imports successifs, parfois d'un
 * catalogue tiers qui décale sa numérotation. Une vignette fausse est une erreur
 * silencieuse — elle a l'air juste.
 *
 * `bxc frames search --remote` interroge trace.moe, qui indexe l'anime image par
 * image. Le point important pour nous : **l'image ne quitte jamais la machine**.
 * bxc calcule localement un vecteur ColorLayout de 33 entiers et n'envoie que
 * lui. On obtient en retour le titre, le numéro d'épisode et le timecode.
 *
 * ── Lire le résultat ─────────────────────────────────────────────────────────
 * La similarité se lit par bandes, mesurées sur nos propres images le
 * 2026-09-12 :
 *
 *   ≥ 0,85   ferme. Une vignette DBS rendait 0,9998 sur l'épisode reconnu.
 *   0,50-0,85 plausible. Nos vignettes DBZ tournent autour de 0,75 : elles sont
 *            recadrées et ré-encodées, ce qui suffit à faire chuter le score
 *            sans changer la scène. Un désaccord dans cette bande se vérifie à
 *            l'œil, il ne se corrige pas tout seul.
 *   < 0,50   aucune information. trace.moe rend alors n'importe quel anime
 *            (« Cyborg Kuro-chan »), ce qui est le signe à reconnaître.
 *
 * Le script n'écrit donc RIEN en base. Il produit un rapport ; corriger une
 * attribution reste une décision éditoriale.
 *
 * ── Quota ────────────────────────────────────────────────────────────────────
 * trace.moe accorde 100 recherches par jour et par machine. Le script lit le
 * quota avant de commencer, s'arrête net quand il est atteint, et garde son
 * avancement dans `data/attribution-images.json` : relancé demain, il reprend où
 * il s'est arrêté.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   bun apps/shenron/bot/scripts/images-attribution.ts --lot 10
 *   bun apps/shenron/bot/scripts/images-attribution.ts --series DBS --lot 40
 *   bun apps/shenron/bot/scripts/images-attribution.ts --rapport   # sans réseau
 */
import postgres from "postgres";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname; // apps/shenron/bot/
const ETAT = join(ROOT, "data", "attribution-images.json");
const RAPPORT = join(ROOT, "..", "..", "docs", "attribution-images.md");
const BXC = process.env.BXC_CLI ?? join(userHome(), "bxc/src/cli/index.ts");

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d?: string) => {
	const i = args.indexOf(`--${n}`);
	return i >= 0 ? (args[i + 1] ?? d) : d;
};

const LOT = Math.max(1, Math.min(100, Number(opt("lot", "10")) || 10));
const SERIE = opt("series");
const SEUIL_FERME = 0.85;
const SEUIL_BRUIT = 0.5;

/**
 * Cinq issues, parce que quatre mentaient.
 *
 * Séparer l'accord du désaccord DANS la bande moyenne est ce qui rend le
 * rapport lisible : nos vignettes DBZ ré-encodées tournent à 0,6-0,8 tout en
 * désignant le bon épisode. Les ranger avec les vraies suspicions noierait les
 * quelques erreurs réelles dans des centaines de lignes sans intérêt.
 */
type TypeVerdict =
	| "confirme"
	| "desaccord"
	| "plausible-accord"
	| "plausible-desaccord"
	| "sans-reponse";

interface Verdict {
	id: number;
	series: string;
	episode: number;
	image: string;
	titreTrouve: string | null;
	episodeTrouve: number | null;
	similarite: number | null;
	timecodeMs: number | null;
	verdict: TypeVerdict;
	vuLe: string;
}

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(ROOT, "..", "site", ".env"))
		.text()
		.catch(() => "");
	const valeur = texte
		.split("\n")
		.findLast((l) => l.startsWith("DATABASE_URL="))
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) throw new Error("DATABASE_URL introuvable");
	return valeur;
}

async function bxc(argv: string[], timeoutMs = 120_000): Promise<string> {
	const proc = Bun.spawn(["bun", BXC, ...argv], { stdout: "pipe", stderr: "pipe" });
	const minuteur = setTimeout(() => proc.kill(), timeoutMs);
	const sortie = await new Response(proc.stdout).text();
	await proc.exited;
	clearTimeout(minuteur);
	return sortie;
}

/** La règle de lecture, en un seul endroit — le rapport la rejoue sans réseau. */
function verdictPour(similarite: number, memeNumero: boolean): TypeVerdict {
	if (similarite < SEUIL_BRUIT) return "sans-reponse";
	if (similarite >= SEUIL_FERME) return memeNumero ? "confirme" : "desaccord";
	return memeNumero ? "plausible-accord" : "plausible-desaccord";
}

const deja: Record<string, Verdict> = await Bun.file(ETAT)
	.json()
	.catch(() => ({}));

/** Écrit le rapport lisible à côté de l'état machine. */
async function ecrireRapport(): Promise<void> {
	// Les verdicts se recalculent à la lecture : affiner la règle ne coûte pas
	// une seule requête de quota.
	const tous = Object.values(deja).map((v) => (Object.assign(v, { verdict: verdictPour(v.similarite ?? 0, v.episodeTrouve !== null && Number(v.episodeTrouve) === Number(v.episode)) })));
	const par = (v: TypeVerdict) => tous.filter((t) => t.verdict === v);
	const desaccords = par("desaccord").toSorted((a, b) => (b.similarite ?? 0) - (a.similarite ?? 0));
	const plausibles = par("plausible-desaccord").toSorted(
		(a, b) => (b.similarite ?? 0) - (a.similarite ?? 0)
	);
	const lignes = [
		"# Attribution des vignettes d'épisode",
		"",
		"Produit par `bun apps/shenron/bot/scripts/images-attribution.ts` : chaque vignette est",
		"comparée à l'index image par image de trace.moe, interrogé par bxc. Seul un",
		"vecteur de 33 entiers quitte la machine, jamais l'image.",
		"",
		`Vignettes examinées : **${tous.length}**.`,
		"",
		"| Verdict | Nombre | Lecture |",
		"|---|---:|---|",
		`| Confirmé | ${par("confirme").length} | même épisode, similarité ≥ ${SEUIL_FERME} |`,
		`| Désaccord | ${desaccords.length} | autre épisode reconnu avec une similarité ≥ ${SEUIL_FERME} |`,
		`| Accord probable | ${par("plausible-accord").length} | même épisode, similarité ${SEUIL_BRUIT}–${SEUIL_FERME} (vignette ré-encodée) |`,
		`| À vérifier | ${plausibles.length} | autre épisode, similarité ${SEUIL_BRUIT}–${SEUIL_FERME} |`,
		`| Sans réponse | ${par("sans-reponse").length} | rien au-dessus de ${SEUIL_BRUIT} |`,
		"",
	];
	if (desaccords.length > 0) {
		lignes.push(
			"## Désaccords — la vignette montre un autre épisode",
			"",
			"| Fiche | Notre étiquette | Reconnu | Similarité | Image |",
			"|---|---|---|---:|---|",
			...desaccords.map(
				(d) =>
					`| ${d.id} | ${d.series} ${d.episode} | ${d.titreTrouve} ${d.episodeTrouve} | ${(d.similarite ?? 0).toFixed(3)} | \`${d.image}\` |`
			),
			""
		);
	}
	if (plausibles.length > 0) {
		lignes.push(
			"## À vérifier à l'œil",
			"",
			"| Fiche | Notre étiquette | Reconnu | Similarité |",
			"|---|---|---|---:|",
			...plausibles
				.slice(0, 60)
				.map(
					(d) =>
						`| ${d.id} | ${d.series} ${d.episode} | ${d.titreTrouve} ${d.episodeTrouve ?? "?"} | ${(d.similarite ?? 0).toFixed(3)} |`
				),
			""
		);
	}
	lignes.push(
		"Rien n'est corrigé automatiquement : remplacer une vignette est une décision",
		"éditoriale, et une similarité moyenne ne suffit pas à la prendre.",
		""
	);
	await Bun.write(RAPPORT, lignes.join("\n"));
}

if (flag("rapport")) {
	await ecrireRapport();
	console.log(`${Object.keys(deja).length} vignette(s) au rapport → docs/attribution-images.md`);
	process.exit(0);
}

const quotaBrut = await bxc(["frames", "quota", "--json"], 30_000);
const quota = JSON.parse(quotaBrut) as { quota?: number; quotaUsed?: number };
const restant = (quota.quota ?? 0) - (quota.quotaUsed ?? 0);
console.log(`quota trace.moe : ${restant} recherche(s) disponible(s) aujourd'hui`);
if (restant <= 0) {
	console.log("rien à faire — le quota se recharge chaque jour");
	process.exit(0);
}

const sql = postgres(await urlBase(), { max: 2, prepare: false });
const episodes = (await sql`
	select id, series, number_in_series as episode, image
	from bot.db_episodes
	where visible and image is not null and image <> ''
	${SERIE ? sql`and series = ${SERIE}` : sql``}
	order by series, number_in_series
`) as unknown as { id: number; series: string; episode: number; image: string }[];

const aFaire = episodes.filter((e) => !deja[String(e.id)]).slice(0, Math.min(LOT, restant));
console.log(
	`${episodes.length} vignette(s) au catalogue, ${Object.keys(deja).length} déjà examinée(s), ` +
		`${aFaire.length} dans ce lot`
);

let confirmes = 0;
let desaccords = 0;
for (const e of aFaire) {
	const chemin = join(ROOT, e.image.replace(/^\.\//, ""));
	if (!(await Bun.file(chemin).exists())) {
		console.log(`  · ${e.series} ${e.episode} — fichier absent, ignoré`);
		continue;
	}
	const brut = await bxc(["frames", "search", chemin, "--remote", "--limit", "3", "--json"]);
	let meilleur: { title?: string; episode?: number | null; similarity?: number; atMs?: number } | null =
		null;
	try {
		const data = JSON.parse(brut) as { matches?: typeof meilleur[] };
		meilleur =
			(data.matches ?? []).find((m) => /dragon ball/i.test(m?.title ?? "")) ??
			(data.matches ?? [])[0] ??
			null;
	} catch {
		meilleur = null;
	}
	const sim = meilleur?.similarity ?? 0;
	// `number_in_series` peut revenir en chaîne selon le type SQL : comparer sans
	// convertir rendait « DB 6 reconnu Dragon Ball 6 » en désaccord.
	const memeNumero =
		meilleur?.episode !== null &&
		meilleur?.episode !== undefined &&
		Number(meilleur.episode) === Number(e.episode);
	const verdict = verdictPour(sim, memeNumero);
	if (verdict === "confirme") confirmes++;
	if (verdict === "desaccord") desaccords++;
	deja[String(e.id)] = {
		id: e.id,
		series: e.series,
		episode: e.episode,
		image: e.image,
		titreTrouve: meilleur?.title ?? null,
		episodeTrouve: meilleur?.episode ?? null,
		similarite: meilleur?.similarity ?? null,
		timecodeMs: meilleur?.atMs ?? null,
		verdict,
		vuLe: new Date().toISOString(),
	};
	const marque = {
		confirme: "✓",
		desaccord: "✗",
		"plausible-accord": "~",
		"plausible-desaccord": "?",
		"sans-reponse": "·",
	}[verdict];
	console.log(
		`  ${marque} ${e.series} ${e.episode} → ${meilleur?.title ?? "rien"} ${meilleur?.episode ?? ""} (${sim.toFixed(3)})`
	);
	await Bun.write(ETAT, JSON.stringify(deja, null, "\t"));
}

await ecrireRapport();
console.log(
	`\n${aFaire.length} examinée(s) : ${confirmes} confirmée(s), ${desaccords} en désaccord — ` +
		"rapport dans docs/attribution-images.md"
);
await sql.end();
