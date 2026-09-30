/**
 * Nom accessible des champs de formulaire côté public.
 *
 * Un `placeholder` n'est PAS un nom accessible : il disparaît à la saisie, et
 * plusieurs lecteurs d'écran ne l'annoncent pas du tout. Le site comptait
 * 26 champs publics dans ce cas — recherche du wiki, saisie de l'assistant,
 * éditeur de tierlist, pistes de sous-titres — donc autant de « zone de texte,
 * vide » sans plus d'indication.
 *
 * Ce test relit les sources : un champ compte comme nommé s'il porte
 * `aria-label`/`aria-labelledby`/`title`, s'il est enveloppé par un `<label>`,
 * ou si un `<label htmlFor>` le désigne à proximité.
 */
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { fileURLToPath } from "node:url";

/** Primitives génériques : c'est l'appelant qui fournit le nom, par les props. */
const PRIMITIVES = new Set(["src/components/ui/input.tsx", "src/components/ui/textarea.tsx"]);

const racine = fileURLToPath(new URL("..", import.meta.url));

/**
 * Composants du dépôt qui rendent eux-mêmes un `<label>` autour de ce qu'on
 * leur passe (cf. `PanelField` dans `components/editor/ui/primitives.tsx`).
 * Un champ enveloppé par l'un d'eux A un nom accessible — le test lisant les
 * sources, il ne peut pas le déduire tout seul, et il signalait 13 champs
 * pourtant corrects du module d'édition.
 */
const ENVELOPPES_NOMMANTES = /<(PanelField|PlainField)\b[^>]*\blabel=/;

async function champsSansNom(): Promise<string[]> {
	const sans: string[] = [];
	for (const dossier of ["src/components", "src/app"]) {
		for await (const rel of new Glob("**/*.tsx").scan({ cwd: `${racine}${dossier}` })) {
			const chemin = `${dossier}/${rel}`.replaceAll("\\", "/");
			// L'admin est hors périmètre public : traité séparément.
			if (chemin.includes("/admin/") || PRIMITIVES.has(chemin)) continue;
			const lignes = (await Bun.file(`${racine}${chemin}`).text()).split("\n");
			let dansCommentaire = false;
			for (let i = 0; i < lignes.length; i++) {
				const ligne = lignes[i]!;
				// Une docstring qui PARLE d'un `<textarea>` n'en rend pas un.
				const ouvre = ligne.lastIndexOf("/*");
				const ferme = ligne.lastIndexOf("*/");
				const commentaire = dansCommentaire || /^\s*(\*|\/\/)/.test(ligne);
				if (ouvre !== -1 && ouvre > ferme) dansCommentaire = true;
				else if (ferme !== -1 && ferme > ouvre) dansCommentaire = false;
				if (commentaire) continue;

				if (!/<(input|select|textarea)\b/.test(ligne)) continue;
				let bloc = "";
				for (let j = i; j < Math.min(i + 18, lignes.length); j++) {
					bloc += `${lignes[j]}\n`;
					if (/\/>|<\/(input|select|textarea)>/.test(lignes[j]!)) break;
				}
				// Un champ caché n'est pas exposé à l'arbre d'accessibilité : ni
				// `type="hidden"`, ni `display:none` (la classe `hidden` de
				// Tailwind) — c'est ainsi qu'on déclenche un sélecteur de fichier
				// depuis un vrai bouton, lui-même nommé.
				if (/type="hidden"/.test(bloc)) continue;
				if (/className="[^"]*\bhidden\b/.test(bloc)) continue;
				if (/aria-label|aria-labelledby|\btitle=/.test(bloc)) continue;
				const amont = lignes.slice(Math.max(0, i - 14), i).join("\n");
				const ouvert = amont.lastIndexOf("<label");
				if (ouvert !== -1 && !amont.slice(ouvert).includes("</label>")) continue; // <label> englobant
				if (/<label[^>]*htmlFor/.test(amont + lignes.slice(i, i + 18).join("\n"))) continue;
				// La DERNIÈRE enveloppe ouverte, pas la première : deux champs qui se
				// suivent laissent le `</PanelField>` du précédent dans la fenêtre
				// amont, et chercher en avant faisait croire l'enveloppe refermée.
				const ouvertures = [...amont.matchAll(new RegExp(ENVELOPPES_NOMMANTES, "g"))];
				const derniere = ouvertures.at(-1);
				if (
					derniere?.index !== undefined &&
					!/<\/(PanelField|PlainField)>/.test(amont.slice(derniere.index))
				)
					continue;
				sans.push(`${chemin}:${i + 1}`);
			}
		}
	}
	return sans.sort();
}

describe("accessibilité des formulaires publics", () => {
	test("aucun champ public n'est dépourvu de nom accessible", async () => {
		expect(await champsSansNom()).toEqual([]);
	});
});
