/**
 * L'espace /admin ne doit rien rendre à un visiteur anonyme.
 *
 * Régression vécue le 2026-08-22 : `app/admin/layout.tsx` appelait bien
 * `requireAdmin()`, mais sous Next 16 le layout et ses enfants sont streamés en
 * parallèle — la redirection partait dans le flux RSC alors que les pages
 * avaient déjà été rendues et leur charge utile émise. Mesuré sur la prod, un
 * anonyme recevait un **200 avec les données** : 851 Kio de titres sur
 * `/admin/db-universe/databooks`, et 470 Kio contenant 7 032 segments de
 * japonais transcrit sur `/admin/databooks/19`.
 *
 * Le gating a donc été déplacé dans `proxy.ts`, seule couche qui s'exécute
 * avant le rendu. Ce test verrouille le résultat : **une redirection, jamais un
 * 200**. Il tient sur le statut plutôt que sur l'absence de tel ou tel mot —
 * un 200 sur /admin est déjà la panne, quel que soit son contenu.
 *
 * Tier `live` (tape la prod, comme `no-404`) : `bun run test:live`.
 */
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { fileURLToPath } from "node:url";

const BASE = process.env.SITE_URL ?? "https://dragonballfr.com";
const racine = fileURLToPath(new URL("..", import.meta.url));

/** Valeurs réelles pour les segments dynamiques — une page 404 ne prouverait rien. */
const ECHANTILLONS: Record<string, string> = {
	"[id]": "19",
	"[table]": "db_databooks",
	"[param]": "1",
};

/** `src/app/admin/**\/page.tsx` → chemin URL, groupes `(x)` transparents. */
function cheminUrl(fichier: string): string | null {
	fichier = fichier.replaceAll("\\", "/");
	const rel = fichier.replace(/^src\/app/, "").replace(/\/page\.tsx$/, "");
	const segments: string[] = [];
	for (const seg of rel.split("/").filter(Boolean)) {
		if (seg.startsWith("(") && seg.endsWith(")")) continue;
		if (seg.startsWith("[")) {
			const valeur = ECHANTILLONS[seg];
			if (!valeur) return null;
			segments.push(valeur);
			continue;
		}
		segments.push(seg);
	}
	return `/${segments.join("/")}`;
}

const pages = [...new Glob("src/app/admin/**/page.tsx").scanSync(racine)]
	.map(cheminUrl)
	.filter((u): u is string => u !== null)
	.sort();

describe("l'espace /admin est fermé aux anonymes", () => {
	test("le recensement des pages admin n'est pas vide", () => {
		// Sans ce garde-fou, un glob cassé ferait passer la suite en « 0 test vert ».
		expect(pages.length).toBeGreaterThan(20);
	});

	for (const chemin of pages) {
		test(`${chemin} redirige un anonyme`, async () => {
			const r = await fetch(`${BASE}${chemin}`, {
				redirect: "manual",
				headers: { "user-agent": "shenron-tests/admin-no-leak" },
				signal: AbortSignal.timeout(20_000),
			});
			// 3xx = le proxy a tranché avant tout rendu. Un 200 signifie que la page
			// a été rendue et servie — donc que son contenu est parti sur le réseau.
			expect(r.status).toBeGreaterThanOrEqual(300);
			expect(r.status).toBeLessThan(400);
		});
	}
});
