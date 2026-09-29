/**
 * harvest-kanzenshuu-aphrody.ts — renforce le corpus d'auteur `.aphrody` avec
 * les traductions de Kanzenshuu, récoltées par le moteur navigateur `bxc`.
 *
 * Le constat qui a motivé ce script : `.aphrody` ne portait QUE 7 documents
 * d'auteur (interviews Daizenshuu, Super Exciting Guide, introductions de
 * tankōbon), alors que l'archive des traductions de Kanzenshuu en compte **302**
 * — round-tables des éditeurs, Shenlong Times des sept Daizenshuu, Chōzenshū,
 * Dragon Ball Forever, messages de Toriyama en tête de guide. Ce sont des
 * paroles d'auteur et d'éditeur imprimées chez Shueisha : exactement la matière
 * que `/wiki/canon` promet, et que le RAG n'avait pas.
 *
 * Pourquoi `bxc` et pas `fetch` : ces pages sont rendues côté client derrière un
 * thème WordPress, et l'API REST du site n'expose PAS cette section (les
 * traductions ne sont ni `post` ni type public — vérifié sur `/wp-json/wp/v2`).
 * `bxc scrape --markdown` ouvre la page dans un vrai moteur et rend du GFM.
 *
 * Doctrine, appliquée sans exception (cf. `CLAUDE.md`) :
 *   - la liste des URL vient du **sitemap** du site, pas d'un crawl sauvage ;
 *   - un délai sépare deux requêtes ; le script est reprenable et ne refait
 *     jamais une page déjà déposée ;
 *   - rien n'est réécrit ni résumé : le markdown déposé est ce que la page dit,
 *     avec sa source et son URL en tête. Une page trop courte est ignorée
 *     plutôt que déposée à moitié.
 *
 * Sortie : `~/.aphrody/workspace/memory/kanzenshuu-trad_<slug>.md`, relu ensuite
 * par `ingest-aphrody-rag.ts` (RAG) et disponible pour `canon-charge-aphrody.ts`.
 *
 * Usage :
 *   bun apps/shenron/bot/scripts/harvest-kanzenshuu-aphrody.ts --limite 5   # essai
 *   bun apps/shenron/bot/scripts/harvest-kanzenshuu-aphrody.ts --tout
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { bxcCommand } from "@shenron/pipeline/bxc/cli";

const SITEMAPS = [
	"https://www.kanzenshuu.com/page-sitemap.xml",
	"https://www.kanzenshuu.com/page-sitemap2.xml",
	"https://www.kanzenshuu.com/page-sitemap3.xml",
];
const PREFIXE = "kanzenshuu-trad_";
/**
 * Le pont Rust de bxc : sans lui, tous les profils de rendu échouent et la page
 * revient VIDE — sans erreur au niveau du processus.
 *
 * Le chemin que bxc cherche par défaut (`~/bxc/rust-bridge/target/release/`)
 * n'existe pas sur ce VPS ; la bibliothèque est installée à côté du binaire.
 * On résout donc le premier candidat qui existe RÉELLEMENT, et on refuse de
 * démarrer sinon : une récolte qui tourne sans pont dépose un corpus vide en
 * silence, ce qui est pire qu'un échec franc.
 */
function pontRust(): string {
	const candidats = [
		process.env.BXC_RUST_BRIDGE_LIB,
		join(homedir(), ".bxc", "bin", "libbxc_rust_bridge.so"),
		join(homedir(), "bxc", "rust-bridge", "target", "release", "libbxc_rust_bridge.so"),
	].filter((c): c is string => Boolean(c));
	for (const c of candidats) if (existsSync(c)) return c;
	throw new Error(
		`Pont Rust de bxc introuvable (essayés : ${candidats.join(", ")}). ` +
			"Installer avec `bxc install --full` ou pointer BXC_RUST_BRIDGE_LIB."
	);
}
const BRIDGE = pontRust();
const DELAI_MS = Number(process.env.KZ_DELAI_MS ?? 4000);

const argLimite = process.argv.findIndex((a) => a === "--limite");
const LIMITE = argLimite > -1 ? Number(process.argv[argLimite + 1]) : process.argv.includes("--tout") ? Infinity : 3;

async function corpusMemoire(): Promise<string> {
	const candidats = [
		process.env.APHRODY_HOME,
		join(homedir(), ".aphrody", "workspace"),
		join(homedir(), ".aphrody", "workspaces", "dbfr"),
	].filter((c): c is string => Boolean(c));
	for (const base of candidats) {
		if (await Bun.file(join(base, "ai.json")).exists()) return join(base, "memory");
	}
	throw new Error(`Corpus .aphrody introuvable (essayés : ${candidats.join(", ")}).`);
}

/**
 * Le corps de l'article, isolé du thème.
 *
 * Le markdown rendu porte l'en-tête du site, le fil d'Ariane, le formulaire de
 * connexion du forum et un nuage de tags de 4 000 caractères. Indexer ça
 * ferait ressortir « Xenoverse 2 (73) » comme passage sourcé. Le repère fiable
 * est le premier **soulignement setext** (`------`) : c'est le titre de
 * l'ouvrage traduit, et tout ce qui le précède est du chrome.
 */
function corpsDArticle(markdown: string): string {
	const lignes = markdown.split("\n");
	const iSoulignement = lignes.findIndex((l) => /^-{5,}\s*$/.test(l));
	if (iSoulignement < 1) return "";
	const corps = lignes.slice(iSoulignement - 1);
	// Le pied de page, quand le thème en rend un, commence à l'un de ces repères.
	const iFin = corps.findIndex((l) =>
		/^(Leave a Reply|Post navigation|Follow Kanzenshuu|Search for:)/i.test(l.trim())
	);
	return (iFin > 0 ? corps.slice(0, iFin) : corps).join("\n").trim();
}

/** Le titre lisible : la première ligne du corps, celle que souligne `-----`. */
function titreDe(corps: string): string {
	return corps.split("\n")[0]?.replace(/[*_`#]/g, "").trim() ?? "";
}

async function scrape(url: string): Promise<{ markdown: string; erreur: string }> {
	const proc = Bun.spawn([...(await bxcCommand()), "scrape", url, "--markdown"], {
		env: { ...process.env, BXC_RUST_BRIDGE_LIB: BRIDGE },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [markdown, erreur] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	await proc.exited;
	return { markdown, erreur };
}

/**
 * Une page vide n'est pas une page absente : c'est presque toujours le site qui
 * limite le débit. On réessaie une fois, après une pause franche, avant de
 * conclure — sinon une rafale trop rapide se solderait par un corpus à trous
 * que rien ne signale.
 */
async function corpsAvecReprise(url: string): Promise<{ corps: string; erreur: string }> {
	for (let essai = 0; essai < 2; essai++) {
		const { markdown, erreur } = await scrape(url);
		const corps = corpsDArticle(markdown);
		if (corps.length >= 600) return { corps, erreur };
		if (essai === 0) await Bun.sleep(DELAI_MS * 4);
		else return { corps, erreur };
	}
	return { corps: "", erreur: "" };
}

// ── Récolte ─────────────────────────────────────────────────────────────────

const memoire = await corpusMemoire();
await mkdir(memoire, { recursive: true });
const deja = new Set(await readdir(memoire));

const urls: string[] = [];
for (const sitemap of SITEMAPS) {
	const xml = await fetch(sitemap).then((r) => (r.ok ? r.text() : ""));
	for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
		const url = m[1];
		if (url.includes("/translations/") && !url.endsWith("/translations/")) urls.push(url);
	}
}
const uniques = [...new Set(urls)];
console.log(`→ ${uniques.length} traductions listées par le sitemap Kanzenshuu.`);

let deposes = 0;
let ignores = 0;
let sautes = 0;
for (const url of uniques) {
	const slug = url.replace(/\/$/, "").split("/").pop() ?? "";
	const fichier = `${PREFIXE}${slug}.md`;
	if (deja.has(fichier)) {
		sautes++;
		continue;
	}
	if (deposes >= LIMITE) break;

	const { corps, erreur } = await corpsAvecReprise(url);
	// Une page qui ne rend presque rien est une page qui n'a pas chargé, pas une
	// page courte : la déposer polluerait le corpus d'un titre sans texte.
	if (corps.length < 600) {
		console.warn(
			`  ⨯ ${slug} — corps trop court (${corps.length} car.), ignoré. ${erreur.trim().split("\n").at(-1) ?? ""}`
		);
		ignores++;
		await Bun.sleep(DELAI_MS);
		continue;
	}
	const titre = titreDe(corps);
	const entete = [
		"---",
		`title: ${JSON.stringify(titre)}`,
		`source: ${JSON.stringify(`${titre} (trad. Kanzenshuu)`)}`,
		`url: ${url}`,
		"lang: en",
		`harvested: ${new Date().toISOString().slice(0, 10)}`,
		"---",
		"",
	].join("\n");
	await writeFile(join(memoire, fichier), entete + corps + "\n", "utf-8");
	deposes++;
	console.log(`  ✓ ${slug} — ${corps.length} car. — ${titre}`);
	await Bun.sleep(DELAI_MS);
}

console.log(
	`✓ ${deposes} déposés, ${sautes} déjà présents, ${ignores} ignorés (corps vide) sur ${uniques.length}.`
);
console.log("→ Enchaîner : bun apps/shenron/bot/scripts/ingest-aphrody-rag.ts --injecte");
