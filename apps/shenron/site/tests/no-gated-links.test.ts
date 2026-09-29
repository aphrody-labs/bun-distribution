/**
 * Aucune page publique ne doit lier une rubrique fermée.
 *
 * C'est le test qui manquait : au 2026-08-21, `/wiki/sagas` — page publique —
 * émettait **65 liens vers `/wiki/arcs/*`**, rubrique alors fermée, tous soldés
 * par une redirection 307 vers `/wiki-bientot`. Un mur d'impasses pour le
 * visiteur comme pour le crawler, invisible depuis le code puisque chaque lien
 * pris isolément semblait légitime.
 *
 * Le test est STATIQUE (analyse des sources, pas de DB ni de réseau) : il tourne
 * en CI sans dépendance. Il ne peut pas connaître la configuration réelle de
 * production, donc il vérifie la propriété structurelle qui, elle, doit tenir
 * quelle que soit la configuration : une page appartenant à une rubrique
 * gatable ne doit pas écrire en dur un lien vers une AUTRE rubrique gatable —
 * elle doit passer par `GatedLink`/`GatedWrap`, qui neutralisent la cible fermée.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { GATEABLE_CATEGORIES } from "../src/lib/wiki-launch";

const SRC = join(import.meta.dir, "..", "src");
const APP = join(SRC, "app");
const COMPOSANTS = join(SRC, "components");

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) {
			// L'admin est réservé au staff : le gating n'y a pas cours.
			if (name === "admin" || name === "api") continue;
			out.push(...walk(p));
		} else if (name.endsWith(".tsx")) {
			out.push(p);
		}
	}
	return out;
}

function portablePath(file: string): string {
	return file.replaceAll("\\", "/");
}

/** Préfixes des rubriques refermables depuis /admin/lancement. */
const GATEABLE_PREFIXES = GATEABLE_CATEGORIES.flatMap((c) => c.prefixes);

/** Fichiers autorisés à mentionner une rubrique fermée. */
const ALLOWED = [
	// Ces composants EXISTENT pour neutraliser un lien fermé.
	"components/GatedLink.tsx",
	"components/GatedClientLink.tsx",
	// La page « bientôt » et la recherche parlent des rubriques par nature.
	"app/wiki-bientot",
	"app/wiki/search",
	// Le plan du site filtre lui-même par `isPathPublic`.
	"app/sitemap.ts",
];

/**
 * Grilles client montées UNIQUEMENT sur l'index de leur propre rubrique : elles
 * lient leurs propres fiches, et ne sont jamais rendues quand la rubrique est
 * fermée (le proxy redirige la page qui les porte). Le test suivant vérifie que
 * cette exclusivité tient toujours — un import ailleurs les ferait retomber sous
 * la règle générale.
 */
const OWN_SECTION_COMPONENTS: Record<string, string> = {
	"components/wiki/BattlesGrid.tsx": "combats",
	"components/wiki/GamesExplorer.tsx": "jeux",
	"components/wiki/ItemsGrid.tsx": "objets",
	"components/wiki/LocationsGrid.tsx": "lieux",
	"components/wiki/TournamentsGrid.tsx": "tournois",
	"components/wiki/VoiceActorsGrid.tsx": "voix",
};

/**
 * Le `href` trouvé est-il porté par un `<GatedLink>` / `<GatedWrap>` ?
 *
 * L'ancienne version se contentait de chercher `<GatedLink` N'IMPORTE OÙ dans le
 * fichier : un seul lien protégé exemptait toute la page. C'est exactement ce qui
 * a laissé passer `/wiki/arcs`, où un `GatedLink` voisinait un `<Link>` nu.
 */
function estProtege(src: string, index: number): boolean {
	// Remonte jusqu'à l'ouverture de balise qui porte cet attribut.
	const debut = src.lastIndexOf("<", index);
	if (debut === -1) return false;
	return /^<(?:Gated(?:Link|Wrap)|ClientGatedWrap)\b/.test(src.slice(debut, debut + 18));
}

describe("liens vers les rubriques gatables", () => {
	// Les composants partagés comptent autant que les pages : `WikiCategoryNav`
	// est monté par TOUTES les pages encyclopédiques, et n'était pas balayé.
	const files = [...walk(APP), ...walk(COMPOSANTS)].filter(
		(f) => !ALLOWED.some((a) => f.includes(a))
	);

	test("le registre expose bien des rubriques refermables", () => {
		expect(GATEABLE_PREFIXES.length).toBeGreaterThan(0);
	});

	test("aucun <Link href> en dur vers une rubrique gatable hors de sa propre rubrique", () => {
		const offenders: string[] = [];

		for (const file of files) {
			const src = readFileSync(file, "utf8");
			// Rubrique à laquelle appartient le fichier : une page de la rubrique X a
			// évidemment le droit de lier X (navigation interne, précédent/suivant).
			const portableFile = portablePath(file);
			const own = GATEABLE_CATEGORIES.filter((c) =>
				c.prefixes.some(
					(p) => portableFile.includes(p.slice(1).replaceAll("/", "\\")) || portableFile.includes(p)
				)
			).map((c) => c.key);
			for (const [suffix, key] of Object.entries(OWN_SECTION_COMPONENTS)) {
				if (portableFile.endsWith(suffix)) own.push(key);
			}

			for (const cat of GATEABLE_CATEGORIES) {
				if (own.includes(cat.key)) continue;
				for (const prefix of cat.prefixes) {
					// On ne regarde que les `href` de `<Link>`/`<a>`, pas les chaînes
					// quelconques (libellés, commentaires, `probe` de test).
					// `href="/wiki/x"` et `href={`/wiki/x/…`}` dans le JSX, mais AUSSI
					// `href: "/wiki/x"` dans une table de liens (`const COLUMNS = [...]`).
					// C'est cette seconde forme qui a laissé le pied de page annoncer une
					// rubrique fermée en bas de CHAQUE page du site.
					const re = new RegExp(
						`href=(?:"${prefix}(?:/|")|\\{\`${prefix}/)|href:\\s*"${prefix}(?:/|")`,
						"g"
					);
					// Un fichier qui résout lui-même le gating (`isPathPublic`) filtre déjà
					// ses liens : c'est une alternative valable à `GatedLink`.
					if (src.includes("isPathPublic")) continue;
					// `<Breadcrumbs>` résout lui-même le gating de ses maillons : un
					// `href:` passé dans ses `items` est déjà neutralisé à la source.
					const parBrisure = /<Breadcrumbs\b/.test(src);
					// Table de liens (`href: "/wiki/x"`) : elle est forcément rendue plus
					// loin dans le fichier, où la protection est visible.
					const parEnveloppe = /<(?:Gated(?:Link|Wrap)|ClientGatedWrap)\b/.test(src);
					const nus = [...src.matchAll(re)].filter((m) => {
						const i = m.index ?? 0;
						if (estProtege(src, i)) return false;
						const litteral = src.slice(i, i + 6).startsWith("href:");
						if (litteral && (parBrisure || parEnveloppe)) return false;
						return true;
					});
					if (nus.length === 0) continue;
					offenders.push(`${file.replace(SRC, "src")} → ${prefix} (${nus.length})`);
				}
			}
		}

		expect(offenders).toEqual([]);
	});

	test("les grilles propres à une rubrique ne sont importées que par elle", () => {
		const offenders: string[] = [];
		for (const [suffix, key] of Object.entries(OWN_SECTION_COMPONENTS)) {
			const name = suffix.slice(suffix.lastIndexOf("/") + 1, -".tsx".length);
			for (const file of [...walk(APP), ...walk(COMPOSANTS)]) {
				const p = portablePath(file);
				if (p.endsWith(suffix)) continue;
				if (!new RegExp(`from "@/components/wiki/${name}"`).test(readFileSync(file, "utf8"))) continue;
				if (!p.includes(`/app/wiki/${key}/`)) offenders.push(`${p.replace(portablePath(SRC), "src")} → ${name}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	test("un composant qui déroule un registre de rubriques résout le gating", () => {
		// Cas vécu : `WikiCategoryNav` itérait `ENCYCLOPEDIA_CATEGORIES` et rendait
		// `<Link href={c.href}>` sans condition. Aucun littéral `/wiki/...` dans le
		// fichier → invisible pour le test ci-dessus, alors que chaque page
		// encyclopédique publiait ainsi trois liens morts.
		const REGISTRES = ["ENCYCLOPEDIA_CATEGORIES", "LAUNCH_CATEGORIES", "GATEABLE_CATEGORIES"];
		const offenders: string[] = [];
		for (const file of [...walk(APP), ...walk(COMPOSANTS)]) {
			if (ALLOWED.some((a) => portablePath(file).includes(a))) continue;
			const src = readFileSync(file, "utf8");
			if (!REGISTRES.some((r) => src.includes(r))) continue;
			if (!/<Link\b|<(?:Gated(?:Link|Wrap)|ClientGatedWrap)\b/.test(src)) continue;
			const resout =
				src.includes("isPathPublic") ||
				src.includes("resolveAccess") ||
				/<(?:Gated(?:Link|Wrap)|ClientGatedWrap)\b/.test(src);
			if (!resout) offenders.push(file.replace(SRC, "src"));
		}
		expect(offenders).toEqual([]);
	});
});
