/**
 * Fills `messages/en.json` and `messages/ja.json` from the French reference,
 * through Google Translate reached by bxc — with the Dragon Ball vocabulary
 * held out of the engine's reach.
 *
 *   bun apps/shenron/site/scripts/i18n-translate.ts            # what is missing
 *   bun apps/shenron/site/scripts/i18n-translate.ts --apply    # translate and write
 *   bun apps/shenron/site/scripts/i18n-translate.ts --apply --locale ja
 *   bun apps/shenron/site/scripts/i18n-translate.ts --apply --force nav
 *
 * Why the glossary is not optional: « Le Kaméhaméha de Son Goku » comes back
 * from Google as *The Goku Sound Camel*. `lib/i18n/glossary` swaps every known
 * name for an opaque token first, and puts the target-language spelling back
 * after — Japanese script for Japanese, Hepburn for English.
 *
 * Two refusals, on purpose:
 *  - a string whose tokens did not all survive the round trip is dropped, never
 *    written half-translated;
 *  - keys already present are left alone unless `--force` names their prefix,
 *    so a human correction is never overwritten by the machine.
 *
 * Machine-translated keys are listed in `messages/.machine.json`, so a reviewer
 * knows exactly what no human has read yet. That file is internal: nothing
 * about it reaches a public page.
 */
import { userHome } from "@aphrody/paths";
import path from "node:path";
import { protect, restore, type GlossaryTerm } from "@/lib/i18n/glossary";
import type { SupportedLocale } from "@/lib/i18n/types";

const RACINE = path.resolve(import.meta.dir, "..");
const MESSAGES = path.join(RACINE, "messages");
const CIBLES: SupportedLocale[] = ["en", "ja"];

/**
 * Key prefixes a machine must not translate: they carry legal meaning.
 *
 * A privacy notice or a licence that says something slightly different in
 * English than in French is not a translation, it is a second contract nobody
 * wrote. These keys are copied verbatim from the French and listed as such, so
 * a reader sees the text that actually binds us and a translator sees the
 * backlog.
 */
const SANS_TRADUCTION = ["legal.", "confidentialite.", "licence."];

const args = process.argv.slice(2);
const APPLIQUER = args.includes("--apply");
const FORCE = valeur("--force");
const SEULEMENT = valeur("--locale") as SupportedLocale | undefined;

function valeur(nom: string): string | undefined {
	const i = args.indexOf(nom);
	return i === -1 ? undefined : args[i + 1];
}

/**
 * The bxc entry point.
 *
 * Source, not the compiled binary: the standalone build is broken for the
 * browser-engine commands (documented in the project memory). `BXC_CLI`
 * overrides it when the checkout moves.
 */
const BXC = process.env.BXC_CLI ?? path.join(userHome(), "bxc/src/cli/index.ts");

type Arbre = { [k: string]: string | Arbre };

const lire = async (fichier: string): Promise<Arbre> =>
	JSON.parse(await Bun.file(path.join(MESSAGES, fichier)).text());

/** `{ nav: { wiki: "Wiki" } }` → `{ "nav.wiki": "Wiki" }`. */
function aplatir(arbre: Arbre, prefixe = ""): Map<string, string> {
	const plat = new Map<string, string>();
	for (const [cle, valeur] of Object.entries(arbre)) {
		const chemin = prefixe ? `${prefixe}.${cle}` : cle;
		if (typeof valeur === "string") plat.set(chemin, valeur);
		else for (const [k, v] of aplatir(valeur, chemin)) plat.set(k, v);
	}
	return plat;
}

/** Writes `nav.wiki` into the tree, creating the branches it needs. */
function poser(arbre: Arbre, chemin: string, texte: string): void {
	const segments = chemin.split(".");
	let noeud = arbre;
	for (const segment of segments.slice(0, -1)) {
		if (typeof noeud[segment] !== "object") noeud[segment] = {};
		noeud = noeud[segment] as Arbre;
	}
	noeud[segments.at(-1)!] = texte;
}

/** Reorders a tree to follow the reference, so the files stay comparable. */
function ordonner(reference: Arbre, cible: Arbre): Arbre {
	const sortie: Arbre = {};
	for (const [cle, valeur] of Object.entries(reference)) {
		const equivalent = cible[cle];
		if (typeof valeur === "string") {
			if (typeof equivalent === "string") sortie[cle] = equivalent;
		} else if (equivalent && typeof equivalent === "object") {
			sortie[cle] = ordonner(valeur, equivalent);
		}
	}
	return sortie;
}

/** ICU placeholders (`{count}`) are code, not prose: they never reach the engine. */
function protegerIcu(texte: string): { texte: string; jetons: string[] } {
	const jetons: string[] = [];
	const sortie = texte.replace(/\{[^{}]+\}/g, (m) => {
		jetons.push(m);
		return `⟦icu${jetons.length - 1}⟧`;
	});
	return { texte: sortie, jetons };
}

function restaurerIcu(texte: string, jetons: string[]): { texte: string; manquants: number } {
	let manquants = 0;
	const sortie = texte.replace(/⟦icu(\d+)⟧/g, (whole, i: string) => jetons[Number(i)] ?? whole);
	for (let i = 0; i < jetons.length; i++) if (!texte.includes(`⟦icu${i}⟧`)) manquants++;
	return { texte: sortie, manquants };
}

/** One call to Google through bxc. Returns null when the engine gives nothing usable. */
async function traduire(texte: string, cible: SupportedLocale): Promise<string | null> {
	const proc = Bun.spawn(["bun", BXC, "google", "translate", texte, "--source", "fr", "--target", cible, "--quiet"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const sortie = (await new Response(proc.stdout).text()).trim();
	await proc.exited;
	if (proc.exitCode !== 0) return null;
	const lignes = sortie.split("\n").map((l) => l.trim()).filter(Boolean);
	const derniere = lignes.at(-1);
	return derniere && derniere !== texte ? derniere : (derniere ?? null);
}

const fr = await lire("fr.json");
const plat = aplatir(fr);
const machine: Record<string, string[]> = await lire(".machine.json")
	.then((v) => v as unknown as Record<string, string[]>)
	.catch(() => ({}));

let totalManquants = 0;
const refuses: { locale: string; cle: string; raison: string }[] = [];

for (const locale of CIBLES) {
	if (SEULEMENT && SEULEMENT !== locale) continue;
	const cible = await lire(`${locale}.json`).catch(() => ({}) as Arbre);
	const existant = aplatir(cible);
	const aFaire = [...plat].filter(
		([cle]) => !existant.has(cle) || (FORCE !== undefined && cle.startsWith(FORCE))
	);
	totalManquants += aFaire.length;
	console.log(`${locale} : ${aFaire.length} clé(s) à traduire sur ${plat.size}`);
	if (!APPLIQUER || aFaire.length === 0) continue;

	const faites: string[] = [];
	const copies: string[] = [];
	for (const [cle, source] of aFaire) {
		if (SANS_TRADUCTION.some((p) => cle.startsWith(p))) {
			poser(cible, cle, source);
			copies.push(cle);
			continue;
		}
		const icu = protegerIcu(source);
		const { text: protege, terms } = protect(icu.texte);
		const brut = await traduire(protege, locale);
		if (!brut) {
			refuses.push({ locale, cle, raison: "moteur muet" });
			continue;
		}
		const rendu = restore(brut, terms as GlossaryTerm[], locale);
		if (rendu.missing.length > 0) {
			refuses.push({
				locale,
				cle,
				raison: `terme perdu : ${rendu.missing.map((i) => terms[i]!.fr).join(", ")}`,
			});
			continue;
		}
		const fini = restaurerIcu(rendu.text, icu.jetons);
		if (fini.manquants > 0) {
			refuses.push({ locale, cle, raison: "variable ICU perdue" });
			continue;
		}
		poser(cible, cle, fini.texte);
		faites.push(cle);
	}

	const ordonnee = ordonner(fr, cible);
	await Bun.write(path.join(MESSAGES, `${locale}.json`), `${JSON.stringify(ordonnee, null, "\t")}\n`);
	machine[locale] = [...new Set([...(machine[locale] ?? []), ...faites])].toSorted();
	if (copies.length > 0) {
		machine[`${locale}:copiéDuFrançais`] = [
			...new Set([...(machine[`${locale}:copiéDuFrançais`] ?? []), ...copies]),
		].toSorted();
	}
	console.log(
		`  ${faites.length} écrite(s)${copies.length ? `, ${copies.length} copiée(s) du français (texte juridique)` : ""} → messages/${locale}.json`
	);
}

if (APPLIQUER) {
	await Bun.write(
		path.join(MESSAGES, ".machine.json"),
		`${JSON.stringify(machine, null, "\t")}\n`
	);
}

if (refuses.length > 0) {
	console.log(`\n${refuses.length} refusée(s) — rien n'est écrit à moitié :`);
	for (const r of refuses.slice(0, 20)) console.log(`  ${r.locale} ${r.cle} — ${r.raison}`);
}
if (!APPLIQUER && totalManquants > 0) console.log("\n(lecture seule — relancer avec --apply)");
