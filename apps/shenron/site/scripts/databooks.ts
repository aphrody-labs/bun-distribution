#!/usr/bin/env bun
/**
 * **Poste de commande de la chaîne databooks.**
 *
 * La chaîne compte neuf scripts, chacun excellent dans son rôle, aucun ne
 * sachant où en est l'ensemble. Conduire une campagne de transcription
 * demandait donc, à chaque tour : une requête SQL écrite à la main pour savoir
 * ce qui restait, un `comm -23` entre le dossier d'images d'un lot et son
 * fichier de résultats pour savoir où un agent interrompu s'était arrêté, un
 * script jetable pour passer le juge de qualité sur un lot avant de le déposer,
 * et un `export SHENRON_ADMIN_TOKEN=$(grep …)` recopié de mémoire. Ce fichier
 * fait ces quatre choses, et rien de plus : il n'écrit pas dans la base, il
 * délègue le dépôt au script qui sait déjà le faire.
 *
 *   bun scripts/databooks.ts etat [--categorie "Saikyō Jump"] [--json]
 *   bun scripts/databooks.ts sante [--json] [--strict]
 *   bun scripts/databooks.ts reste <racine-des-lots> [--ecris]
 *   bun scripts/databooks.ts verifie <resultats.jsonl…>
 *   bun scripts/databooks.ts depose <lot…> [--simulation]
 *
 * `sante` est la commande que fait tourner `shenron-databooks-sante.timer` :
 * elle ne corrige rien, elle constate, et sort en échec sous `--strict` pour
 * qu'une dérive se voie dans le journal au lieu d'attendre qu'on la cherche.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
	chargeOuvrages,
	cheminPlanche,
	connecte,
	RACINE_PLANCHES,
	imagePresente,
	jetonApi,
	type Ouvrage,
	type PlancheBrute,
	texteDePlanche,
	traductionDePlanche,
} from "./_databooks-base";
import { classerDefaut, defautDePlanche, type Defaut } from "../src/lib/databooks-defauts";

const args = process.argv.slice(2);
const commande = args[0] ?? "";
const positionnels = args.slice(1).filter((a) => !a.startsWith("--"));
const opt = (nom: string): string | undefined => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1]! : undefined;
};
const flag = (nom: string) => args.includes(`--${nom}`);

const JSON_SORTIE = flag("json");

function usage(message?: string): never {
	if (message) console.error(`erreur : ${message}\n`);
	console.error(`usage : bun scripts/databooks.ts <commande> [options]

  etat [--categorie <c>] [--databook <ids>] [--json]
        Où en est la transcription, ouvrage par ouvrage.

  sante [--json] [--strict]
        Contrôles d'intégrité du corpus. --strict : sort en échec si anomalie.

  reste <racine-des-lots> [--ecris]
        Pour chaque lot sur disque, les planches encore à transcrire.
        --ecris dépose la liste dans <lot>/reste.txt.

  verifie <resultats.jsonl…>
        Passe le juge de qualité sur un lot AVANT dépôt.

  depose <lot-ou-jsonl…> [--simulation] [--force]
        Vérifie puis dépose (jeton résolu tout seul depuis apps/shenron/site/.env).
        Refuse toute planche fautive, sauf --force.`);
	process.exit(2);
}

/* ------------------------------------------------------------------ mesures */

type EtatOuvrage = {
	id: number;
	titre: string;
	categorie: string | null;
	planches: number;
	transcrites: number;
	fautives: number;
	traduites: number;
	imagesManquantes: number;
};

function mesure(o: Ouvrage): EtatOuvrage {
	let transcrites = 0;
	let fautives = 0;
	let traduites = 0;
	let imagesManquantes = 0;
	for (const p of o.pages) {
		const t = texteDePlanche(p).trim();
		if (t) {
			transcrites++;
			if (defautDePlanche(p, t) !== null) fautives++;
		}
		if (traductionDePlanche(p).trim()) traduites++;
		if (!imagePresente(p)) imagesManquantes++;
	}
	return {
		id: o.id,
		titre: o.title ?? `#${o.id}`,
		categorie: o.category,
		planches: o.pages.length,
		transcrites,
		fautives,
		traduites,
		imagesManquantes,
	};
}

const pct = (n: number, d: number) => (d === 0 ? "—" : `${((100 * n) / d).toFixed(0)}%`);

async function cmdEtat(): Promise<void> {
	const sql = await connecte();
	try {
		const ids = (opt("databook") ?? "")
			.split(",")
			.map((v) => Number(v.trim()))
			.filter((v) => Number.isFinite(v) && v > 0);
		const ouvrages = await chargeOuvrages(sql, {
			ids: ids.length ? ids : undefined,
			categorie: opt("categorie") ?? null,
		});
		const etats = ouvrages.map(mesure);
		if (JSON_SORTIE) {
			console.log(JSON.stringify(etats, null, 2));
			return;
		}
		const total = etats.reduce(
			(a, e) => ({
				planches: a.planches + e.planches,
				transcrites: a.transcrites + e.transcrites,
				fautives: a.fautives + e.fautives,
				traduites: a.traduites + e.traduites,
			}),
			{ planches: 0, transcrites: 0, fautives: 0, traduites: 0 }
		);

		// Par catégorie d'abord : c'est à cette maille qu'on décide d'engager
		// une campagne, pas ouvrage par ouvrage.
		const parCat = new Map<string, { livres: number; planches: number; transcrites: number }>();
		for (const e of etats) {
			const c = e.categorie ?? "(sans catégorie)";
			const v = parCat.get(c) ?? { livres: 0, planches: 0, transcrites: 0 };
			v.livres++;
			v.planches += e.planches;
			v.transcrites += e.transcrites;
			parCat.set(c, v);
		}
		console.log("catégorie                       livres  planches  transcrites");
		for (const [c, v] of [...parCat.entries()].toSorted((a, b) => b[1].planches - a[1].planches)) {
			console.log(
				`${c.padEnd(30)} ${String(v.livres).padStart(6)}  ${String(v.planches).padStart(8)}  ${String(v.transcrites).padStart(6)} ${pct(v.transcrites, v.planches).padStart(5)}`
			);
		}

		console.log("\nles 20 ouvrages qui restent le plus à faire :");
		console.log("   id  planches  transcrites  fautives  traduites  titre");
		for (const e of etats
			.filter((e) => e.transcrites < e.planches)
			.toSorted((a, b) => b.planches - b.transcrites - (a.planches - a.transcrites))
			.slice(0, 20)) {
			console.log(
				`${String(e.id).padStart(5)}  ${String(e.planches).padStart(8)}  ${String(e.transcrites).padStart(11)}  ${String(e.fautives).padStart(8)}  ${String(e.traduites).padStart(9)}  ${e.titre}`
			);
		}

		console.log(
			`\ntotal : ${etats.length} ouvrage(s), ${total.planches} planche(s), ${total.transcrites} transcrite(s) (${pct(total.transcrites, total.planches)}), dont ${total.fautives} fautive(s), ${total.traduites} traduite(s)`
		);
	} finally {
		await sql.end();
	}
}

/* ------------------------------------------------------------------- santé */

type Anomalie = { classe: string; gravite: "grave" | "notable" | "mineure"; detail: string };

async function cmdSante(): Promise<void> {
	const sql = await connecte();
	const anomalies: Anomalie[] = [];
	const compte: Record<string, number> = {};
	const exemples: Record<string, string[]> = {};
	const note = (classe: string, gravite: Anomalie["gravite"], exemple: string): void => {
		compte[classe] = (compte[classe] ?? 0) + 1;
		if ((exemples[classe] ??= []).length < 5) exemples[classe]!.push(exemple);
		if (compte[classe] === 1) anomalies.push({ classe, gravite, detail: "" });
	};

	try {
		// Le jsonb rendu scalaire est le piège maison : postgres-js ré-encode
		// une chaîne quand on écrit `${JSON.stringify(v)}::jsonb`, et la colonne
		// reçoit `"[…]"` au lieu du tableau. Une seule requête le tranche.
		const [scalaires] = await sql<{ n: string }[]>`
			select count(*)::text as n from bot.db_databooks
			where pages is not null and jsonb_typeof(pages) = 'string'`;
		if (Number(scalaires?.n ?? 0) > 0) {
			note("pages jsonb rendu scalaire", "grave", `${scalaires!.n} ouvrage(s)`);
		}

		// `chargeOuvrages` ne rend que les ouvrages qui PORTENT des planches ;
		// ceux dont `pages` est NULL sont référencés mais jamais scannés, et
		// resteraient invisibles à ce contrôle. Ils se comptent à part.
		const [sansScan] = await sql<{ n: string }[]>`
			select count(*)::text as n from bot.db_databooks where pages is null`;
		if (Number(sansScan?.n ?? 0) > 0) {
			note("ouvrage référencé mais jamais scanné", "mineure", `${sansScan!.n} ouvrage(s)`);
		}

		const ouvrages = await chargeOuvrages(sql);
		for (const o of ouvrages) {
			const ref = `#${o.id} ${o.title ?? ""}`.trim();
			if (!o.title?.trim()) note("ouvrage sans titre", "mineure", ref);
			if (!o.cover?.trim()) note("ouvrage sans couverture", "mineure", ref);
			if (o.pages.length === 0) note("ouvrage sans planche", "notable", ref);

			const numeros = new Map<number, number>();
			for (const [i, p] of o.pages.entries()) {
				const n = Number(p.number);
				if (!Number.isFinite(n) || n < 1) {
					note("planche sans numéro exploitable", "grave", `${ref} index ${i}`);
				} else {
					numeros.set(n, (numeros.get(n) ?? 0) + 1);
				}

				// Deux situations très différentes, qu'il ne faut surtout pas
				// confondre : une planche SANS chemin d'image est un emplacement
				// jamais scanné (262 au 2026-08-31, dont 228 pour le seul
				// Daizenshuu 1, qui annonce 233 pages) — c'est une lacune connue
				// du corpus. Une planche AVEC un chemin dont le fichier a disparu
				// est une casse, elle rendra une image morte en ligne.
				const chemin = cheminPlanche(p.image);
				if (chemin === null) {
					note("planche sans scan (emplacement vide)", "notable", `${ref} p${p.number}`);
				} else if (!imagePresente(p)) {
					note("fichier image disparu du disque", "grave", `${ref} p${p.number} → ${chemin}`);
				}

				// Une planche dont le `text` n'est ni une chaîne ni
				// `{kind,markdown}` s'affiche « [object Object] » côté public.
				const brut = (p as PlancheBrute).text;
				if (
					brut !== undefined &&
					brut !== null &&
					typeof brut !== "string" &&
					!(typeof brut === "object" && "markdown" in (brut as object))
				) {
					note("champ `text` de forme inconnue", "grave", `${ref} p${p.number}`);
				}

				const texte = texteDePlanche(p).trim();
				const fr = traductionDePlanche(p).trim();
				// Traduire une planche hallucinée la blanchit : le lecteur reçoit
				// un français lisible qui ne dit rien de la source. C'est le pire
				// résultat que la chaîne puisse produire.
				if (fr && texte && defautDePlanche(p, texte) !== null) {
					note("traduction posée sur une planche fautive", "grave", `${ref} p${p.number}`);
				}
				if (fr && !texte) {
					note("traduction sans source japonaise", "notable", `${ref} p${p.number}`);
				}
			}
			for (const [n, c] of numeros) {
				if (c > 1) note("numéro de planche en double", "notable", `${ref} p${n} ×${c}`);
			}
		}

		// Révisions : un dépôt dont `before` vaut `after` n'est pas annulable.
		// Les colonnes sont en camelCase CITÉ (`"tableName"`) — écrites par
		// Drizzle ; en snake_case, Postgres répond « column does not exist », et
		// un `catch` qui avalerait l'erreur ferait passer ce contrôle pour vert.
		const [rev] = await sql<{ total: string; plates: string; derniere: string | null }[]>`
			select count(*)::text as total,
			       count(*) filter (where before is not distinct from after)::text as plates,
			       max("createdAt") filter (where before is not distinct from after)::date::text
			         as derniere
			from public.wiki_revisions where "tableName" = ${"db_databooks"}`;
		if (rev && Number(rev.plates) > 0) {
			// La date de la DERNIÈRE plate est ce qui distingue une cicatrice
			// (le défaut corrigé le 2026-08-29, qui a laissé son passif) d'une
			// régression en cours. Sans elle, le contrôle crie au loup chaque
			// jour pour un passif figé.
			note(
				"révision de databook non annulable (before = after)",
				"notable",
				`${rev.plates} sur ${rev.total} — la dernière date du ${rev.derniere ?? "?"}`
			);
		}

		// Fichiers présents sur le disque que plus AUCUNE planche ne référence :
		// des ré-uploads (repêchage d'une meilleure source, remplacement d'un
		// scan) jamais nettoyés. Sans conséquence fonctionnelle, mais ils
		// gonflent le dépôt d'images et brouillent tout inventaire.
		const referencees = new Set<string>();
		for (const o of ouvrages) {
			for (const p of o.pages) {
				const c = cheminPlanche(p.image);
				if (c) referencees.add(c);
			}
		}
		const dossierPlanches = join(RACINE_PLANCHES, "databooks");
		let orphelins = 0;
		let octets = 0;
		try {
			for (const f of readdirSync(dossierPlanches)) {
				const chemin = join(dossierPlanches, f);
				if (referencees.has(chemin)) continue;
				const st = statSync(chemin);
				if (!st.isFile()) continue;
				orphelins++;
				octets += st.size;
			}
		} catch {
			/* dossier absent sur un poste sans les scans : rien à dire */
		}
		if (orphelins > 0) {
			note(
				"image orpheline sur le disque",
				"mineure",
				`${orphelins} fichier(s), ${(octets / 1024 / 1024).toFixed(0)} Mo`
			);
		}

		const classes = Object.keys(compte).toSorted((a, b) => (compte[b] ?? 0) - (compte[a] ?? 0));
		if (JSON_SORTIE) {
			console.log(
				JSON.stringify(
					{
						ouvrages: ouvrages.length,
						planches: ouvrages.reduce((n, o) => n + o.pages.length, 0),
						anomalies: classes.map((c) => ({
							classe: c,
							compte: compte[c],
							gravite: anomalies.find((a) => a.classe === c)?.gravite,
							exemples: exemples[c],
						})),
					},
					null,
					2
				)
			);
		} else if (classes.length === 0) {
			console.log(
				`santé : ${ouvrages.length} ouvrage(s), ${ouvrages.reduce((n, o) => n + o.pages.length, 0)} planche(s) — aucune anomalie`
			);
		} else {
			console.log(
				`santé : ${ouvrages.length} ouvrage(s), ${ouvrages.reduce((n, o) => n + o.pages.length, 0)} planche(s)\n`
			);
			for (const c of classes) {
				const g = anomalies.find((a) => a.classe === c)?.gravite ?? "mineure";
				if (compte[c] === 1) {
					// Un constat unique porte déjà son chiffre dans son libellé —
					// afficher « : 1 » au-dessus le rendait illisible.
					console.log(`[${g}] ${c} — ${exemples[c]?.[0] ?? ""}`);
					continue;
				}
				console.log(`[${g}] ${c} : ${compte[c]}`);
				for (const e of exemples[c] ?? []) console.log(`    ${e}`);
				if ((compte[c] ?? 0) > (exemples[c]?.length ?? 0)) {
					console.log(`    … et ${(compte[c] ?? 0) - (exemples[c]?.length ?? 0)} autre(s)`);
				}
			}
		}

		const graves = classes.filter(
			(c) => anomalies.find((a) => a.classe === c)?.gravite === "grave"
		);
		if (flag("strict") && graves.length > 0) process.exit(1);
	} finally {
		await sql.end();
	}
}

/* -------------------------------------------------------------- lots en cours */

/** Les planches d'un lot que le fichier de résultats ne couvre pas encore. */
function resteDuLot(dossier: string): { faites: number; restantes: string[] } | null {
	const images = join(dossier, "images");
	let fichiers: string[];
	try {
		fichiers = readdirSync(images).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
	} catch {
		return null;
	}
	let faits = new Set<string>();
	try {
		const texte = readFileSync(join(dossier, "resultats.jsonl"), "utf8");
		faits = new Set(
			texte
				.split("\n")
				.map((l) => l.trim())
				.filter(Boolean)
				.map((l) => {
					try {
						return basename(String((JSON.parse(l) as { image?: string }).image ?? ""));
					} catch {
						// Ligne tronquée par une interruption : la planche est à refaire.
						return "";
					}
				})
				.filter(Boolean)
		);
	} catch {
		/* pas encore de résultats : tout reste à faire */
	}
	return {
		faites: faits.size,
		restantes: fichiers.filter((f) => !faits.has(f)).toSorted(),
	};
}

function cmdReste(): void {
	const racine = positionnels[0];
	if (!racine) usage("il faut la racine des lots (ex. ~/sj-ocr)");
	let dossiers: string[];
	try {
		dossiers = readdirSync(racine)
			.map((d) => join(racine, d))
			.filter((d) => statSync(d).isDirectory())
			.toSorted();
	} catch {
		usage(`racine illisible : ${racine}`);
	}

	const rapport: { lot: string; faites: number; restantes: string[] }[] = [];
	for (const d of dossiers) {
		const r = resteDuLot(d);
		if (r) rapport.push({ lot: basename(d), faites: r.faites, restantes: r.restantes });
		if (r && flag("ecris") && r.restantes.length) {
			writeFileSync(join(d, "reste.txt"), `${r.restantes.join("\n")}\n`);
		}
	}
	if (JSON_SORTIE) {
		console.log(JSON.stringify(rapport, null, 2));
		return;
	}
	const enCours = rapport.filter((r) => r.restantes.length && r.faites > 0);
	const intacts = rapport.filter((r) => r.faites === 0);
	const finis = rapport.filter((r) => r.restantes.length === 0);
	for (const r of enCours) {
		console.log(`${r.lot} : ${r.faites} faite(s), ${r.restantes.length} restante(s)`);
		console.log(`    ${r.restantes.join(" ")}`);
	}
	console.log(
		`\n${finis.length} lot(s) terminé(s), ${enCours.length} entamé(s), ${intacts.length} intact(s) — ${rapport.reduce((n, r) => n + r.restantes.length, 0)} planche(s) à transcrire`
	);
	if (flag("ecris")) console.log("(liste écrite dans <lot>/reste.txt pour les lots entamés)");
}

/* ---------------------------------------------------------------- vérification */

type Verdict = {
	fichier: string;
	lignes: number;
	defauts: Record<string, number>;
	pires: string[];
};

/** `none`/vide est une sortie valide et le dépôt l'ignore par défaut. */
function defautsBloquants(defauts: Record<string, number>): Record<string, number> {
	return Object.fromEntries(
		Object.entries(defauts).filter(([classe]) => classe !== "ok" && classe !== "vide")
	);
}

function verifieFichier(chemin: string): Verdict {
	const texte = readFileSync(chemin, "utf8");
	const defauts: Record<string, number> = {};
	const pires: string[] = [];
	let lignes = 0;
	for (const l of texte.split("\n")) {
		const brut = l.trim();
		if (!brut) continue;
		lignes++;
		let o: { image?: unknown; text?: { kind?: unknown; markdown?: unknown } };
		try {
			o = JSON.parse(brut);
		} catch {
			defauts["ligne illisible"] = (defauts["ligne illisible"] ?? 0) + 1;
			continue;
		}
		let d: Defaut | "vide" | "format" | null;
		if (typeof o.image !== "string" || !o.image.trim()) {
			d = "format";
		} else if (o.text?.kind === "none") {
			d = "vide";
		} else if (o.text?.kind === "text" && typeof o.text.markdown === "string") {
			d = o.text.markdown.trim() ? classerDefaut(o.text.markdown) : "vide";
		} else {
			// Un objet sans kind n'est pas une page muette : le dépôt ne saurait
			// pas l'interpréter de façon sûre.
			d = "format";
		}
		const clef = d ?? "ok";
		defauts[clef] = (defauts[clef] ?? 0) + 1;
		if (d !== null && pires.length < 12) pires.push(`${o.image ?? "?"} → ${d}`);
	}
	return { fichier: chemin, lignes, defauts, pires };
}

/** Le JSONL d'un lot, qu'on ait donné le fichier ou le dossier qui le contient. */
function jsonlDe(cible: string): string {
	try {
		if (statSync(cible).isDirectory()) return join(cible, "resultats.jsonl");
	} catch {
		/* laissé tel quel : l'erreur de lecture parlera mieux */
	}
	return cible;
}

function cmdVerifie(): void {
	if (positionnels.length === 0) usage("il faut au moins un fichier de résultats");
	const verdicts = positionnels.map((c) => verifieFichier(jsonlDe(c)));
	if (JSON_SORTIE) {
		console.log(JSON.stringify(verdicts, null, 2));
		const fautives = verdicts.reduce(
			(total, v) =>
				total +
				Object.values(defautsBloquants(v.defauts)).reduce((sousTotal, compte) => sousTotal + compte, 0),
			0
		);
		if (fautives > 0) process.exitCode = 1;
		return;
	}
	let fautives = 0;
	for (const v of verdicts) {
		const { ok = 0, ...reste } = v.defauts;
		fautives += Object.values(defautsBloquants(reste)).reduce((a, b) => a + b, 0);
		console.log(
			`${v.fichier} : ${v.lignes} planche(s), ${ok} saine(s)${
				Object.keys(reste).length ? `, ${JSON.stringify(reste)}` : ""
			}`
		);
		for (const p of v.pires) console.log(`    ${p}`);
	}
	if (fautives > 0) process.exitCode = 1;
}

/* --------------------------------------------------------------------- dépôt */

async function cmdDepose(): Promise<void> {
	if (positionnels.length === 0) usage("il faut au moins un lot à déposer");
	// Une simulation ne touche pas l'API et ne doit pas exiger qu'un secret soit
	// présent sur le poste de relecture.
	const jeton = flag("simulation") ? "" : await jetonApi();
	for (const cible of positionnels) {
		const jsonl = jsonlDe(cible);
		const manifeste = join(jsonl.replace(/[\\/]resultats\.jsonl$/, ""), "manifeste.json");
		const v = verifieFichier(jsonl);
		const { ok = 0, ...reste } = v.defauts;
		console.log(
			`${jsonl} : ${v.lignes} planche(s), ${ok} saine(s)${
				Object.keys(reste).length ? `, ${JSON.stringify(reste)}` : ""
			}`
		);
		// Garde-fou : les pages vides sont ignorées par le dépôt, mais une seule
		// planche non vide et fautive suffit à demander une décision explicite.
		// Sinon un lot qui contient quelques hallucinations passerait dès que les
		// pages muettes ont été correctement sorties du calcul.
		const fautives = Object.values(defautsBloquants(reste)).reduce((a, b) => a + b, 0);
		if (fautives > 0 && !flag("force")) {
			console.error(
				`refus : ${fautives} planche(s) fautive(s) — relis-les, ou force avec --force`
			);
			process.exitCode = 1;
			continue;
		}

		const argv = [
			join(import.meta.dir, "depose-transcriptions.ts"),
			jsonl,
			...(existsSync(manifeste) ? ["--manifeste", manifeste] : []),
			...(flag("simulation") ? ["--simulation"] : []),
		];
		const p = Bun.spawnSync(["bun", ...argv], {
			env: { ...process.env, DATABOOKS_API_TOKEN: jeton },
			stdout: "inherit",
			stderr: "inherit",
		});
		if (p.exitCode !== 0) {
			console.error(`échec du dépôt de ${jsonl} (code ${p.exitCode})`);
			process.exitCode = 1;
		}
	}
}

/* ----------------------------------------------------------------- aiguillage */

switch (commande) {
	case "etat":
		await cmdEtat();
		break;
	case "sante":
		await cmdSante();
		break;
	case "reste":
		cmdReste();
		break;
	case "verifie":
		cmdVerifie();
		break;
	case "depose":
		await cmdDepose();
		break;
	default:
		usage(commande ? `commande inconnue : ${commande}` : undefined);
}
