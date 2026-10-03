#!/usr/bin/env bun
import { userHome } from "@aphrody/paths";
/**
 * jimaku-subtitles.ts — Sous-titres JAPONAIS depuis jimaku.cc vers la base :
 * épisodes (`bot.db_episodes.subtitles`) et films (`bot.db_movies.subtitles`),
 * au contrat exact du lecteur du site.
 *
 * Pourquoi. `subtitles` était vide sur les 826 épisodes et les 28 films (mesuré
 * le 2026-09-13). Le lecteur sait pourtant afficher des pistes, l'admin sait en
 * téléverser (`/api/assets/upload-subtitle`), et `/api/subtitles` convertit le
 * SRT en WebVTT à la volée. Il ne manquait que la source. jimaku.cc est un dépôt
 * public de sous-titres japonais indexé par entrée d'anime.
 *
 * Ce que ça sert au projet : du japonais PREMIÈRE MAIN, aligné au timecode,
 * pour un site dont la doctrine place les sources japonaises au-dessus des
 * retraductions.
 *
 * ── Contrat respecté à la lettre ─────────────────────────────────────────────
 * Le même que celui de l'endpoint d'admin, pour qu'un fichier déposé à la main
 * et un fichier moissonné soient indiscernables en aval :
 *   fichier : assets/subtitles/<db_episodes|db_movies>/<id>/<lang>.<srt|vtt>
 *   colonne : subtitles jsonb = SubtitleTrack[] = { lang, label, src }[]
 *   limites : 2 Mo par fichier ; `/api/subtitles` ne sert que .srt et .vtt
 *
 * ── ASS converti, jamais servi tel quel ──────────────────────────────────────
 * Une large part du corpus est en Advanced SubStation (`.ass`) : 85 des 194
 * fichiers de Kai, la quasi-totalité des films. `/api/subtitles` refuse ce
 * format et un navigateur ne sait pas le lire dans `<track>`. Au premier jet,
 * ces fichiers étaient simplement écartés — Kai n'affichait plus que 16 épisodes
 * sur 97 et la garde d'alignement refusait la série pour une raison qui n'en
 * était pas une. On convertit donc à l'ingestion : lignes `Dialogue` de la
 * section `[Events]`, balises `{…}` retirées, `\N` en saut de ligne, dessins
 * vectoriels (`\p1`) écartés. La mise en forme est perdue ; le texte et le
 * minutage, qui sont ce que sert le lecteur, sont conservés.
 *
 * ── Garde de langue ──────────────────────────────────────────────────────────
 * Une entrée mêle parfois des pistes d'autres langues au nom muet. Les noms qui
 * se déclarent étrangers (`.eng.`, `[en]`…) sont écartés d'emblée ; ceux qui ne
 * disent rien sont téléchargés puis MESURÉS : moins de 30 % de kana/kanji parmi
 * leurs lettres, et l'on passe au candidat suivant. Une piste « ja » qui
 * contiendrait de l'anglais serait pire qu'aucune piste.
 *
 * ── Cible Neon, jamais SQLite ────────────────────────────────────────────────
 * `db_episodes` et `db_movies` figurent dans la liste de `_wiki-editorial.ts` :
 * le SQLite du bot est un réplica que le reverse-sync écrase tous les quarts
 * d'heure. Écrire ici, c'est écrire dans Postgres.
 *
 * ── Provenance ───────────────────────────────────────────────────────────────
 * La source est enregistrée dans `bot.db_sources` (licence et gabarit
 * d'attribution compris) avant le premier dépôt : le projet purge les médias
 * sans origine traçable (cf. `purge-fandom-sources.ts`).
 *
 * ── Deux chemins d'accès ─────────────────────────────────────────────────────
 * L'API officielle (`/api/entries/<id>/files`) répond 401 sans clé. Avec
 * `JIMAKU_API_KEY` on la prend ; sans clé, on lit la page publique de l'entrée,
 * rendue côté serveur. Ses liens portent des entités HTML (`World&#39;s`) qu'il
 * faut décoder, sinon le téléchargement vise une URL qui n'existe pas.
 *
 * ── Alignement épisode ───────────────────────────────────────────────────────
 * Le numéro vient du NOM DE FICHIER, jamais de l'ordre de la liste, et jamais
 * d'une numérotation relative à une saison (cf. `numeroDepuisNom`). Quand le
 * nombre d'épisodes publiés diffère de celui de la base, la série est refusée :
 * c'est le seul signal d'un découpage différent (Kai Final Chapters : 61 au
 * Japon, 70 dans la base), et un décalage ne produit aucune erreur visible.
 *
 * ── Films ────────────────────────────────────────────────────────────────────
 * Une entrée jimaku par film, sans numéro : l'appariement se fait sur le titre
 * romanisé, normalisé des deux côtés — casse, ponctuation, espaces, voyelles
 * longues (« Son Gokuu » et « Son Goku », « Kono Yo » et « Konoyo » désignent le
 * même film). Égalité stricte d'abord ; à défaut, un titre qui en prolonge un
 * autre, à condition qu'un seul film corresponde. Sinon l'entrée est écartée et
 * journalisée : pas de rapprochement « au plus proche ».
 *
 * SIMULATION PAR DÉFAUT — sans `--appliquer`, rien n'est téléchargé ni écrit.
 * IDEMPOTENT — une fiche qui porte déjà une piste dans cette langue est sautée.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   bun apps/shenron/bot/scripts/ingest/jimaku-subtitles.ts --series DBZ            # plan
 *   bun apps/shenron/bot/scripts/ingest/jimaku-subtitles.ts --series DBZ_KAI --appliquer
 *   bun apps/shenron/bot/scripts/ingest/jimaku-subtitles.ts --films --appliquer
 *
 *   --series S    série db_episodes visée (défaut DBS)
 *   --entry N     entrée jimaku (défaut : déduit de --series via ENTREES)
 *   --films       traiter les films (db_movies) au lieu d'une série
 *   --lang L      code de langue de la piste (défaut ja)
 *   --de N --a M  borner la plage d'épisodes
 *   --limite N    plafonner le nombre de fiches traitées
 *   --force       réécrire une piste déjà présente dans cette langue
 *   --forcer-alignement  passer outre l'écart de comptage jimaku/base
 *   --recaler     avec --wikipedia : recaler par trace.moe les pistes dont la fin
 *                 dépasse la vidéo de moins de 60 s (cf. `recaler`)
 *   --wikipedia   Kai Final : déposer via data/kai-final-correspondance.json (titres
 *                 ja.wikipedia + interpolation), lecteurs VOSTFR réalignés requis
 *   --appliquer   télécharger et écrire réellement
 *
 * Env : DATABASE_URL (Neon) requis. JIMAKU_API_KEY optionnel.
 * Lancer via systemd-run avec EnvironmentFile (cf. enrich-episode-synopsis.ts).
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

const ROOT = new URL("../..", import.meta.url).pathname; // apps/shenron/bot/
const BASE = "https://jimaku.cc";
const UA = "shenron-dragonballfr/1.0 (+https://dragonballfr.com)";

/**
 * Entrées jimaku des séries de `db_episodes`, relevées le 2026-09-13 sur le
 * catalogue public (35 entrées « Dragon Ball », dont 28 films et spéciaux
 * traités par `--films`). `--entry` reste prioritaire.
 */
const ENTREES: Record<string, number> = {
	DB: 630,
	DBZ: 603,
	DBGT: 951,
	DBS: 1019,
	DB_DAIMA: 7704,
	// Kai 1–97 : numérotation commune au Japon et à la base, alignement vérifié
	// fichier par fichier (97 contre 97) — même arbitrage que crawl-frames.ts.
	DBZ_KAI: 1578,
	// Final Chapters : jimaku numérote 99→159 (61 épisodes japonais), la base en
	// compte 70 (découpage international). Pas de correspondance par numéro : la
	// garde d'alignement refuse la série, `--wikipedia` l'apparie par titres.
	DBZ_KAI_FINAL: 8130,
};

/** Entrées jimaku complémentaires : l'épisode inédit « 98 » de Kai a la sienne. */
const ENTREES_COMPLEMENT: Record<string, number[]> = { DBZ_KAI_FINAL: [8129] };

const SOURCE = {
	id: "jimaku",
	name: "Jimaku (dépôt public de sous-titres japonais)",
	url: "https://jimaku.cc/",
};
const LICENSE_KEY = "FAIR-USE-EDITORIAL";
/** Mention portée par chaque piste déposée — `db_sources.attribution_template`. */
const ATTRIBUTION = "Sous-titres japonais mis à disposition par jimaku.cc";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d?: string) => {
	const i = args.indexOf(`--${n}`);
	return i >= 0 ? (args[i + 1] ?? d) : d;
};
const num = (n: string, d: number) => {
	const v = Number(opt(n, ""));
	return Number.isFinite(v) && v > 0 ? v : d;
};

const FILMS = flag("films");
const SERIES = (opt("series", "DBS") ?? "DBS").toUpperCase();
const ENTRY = num("entry", ENTREES[SERIES] ?? 1019);
const LANG = (opt("lang", "ja") ?? "ja").toLowerCase();
const DE = num("de", 1);
const A = num("a", Number.MAX_SAFE_INTEGER);
const LIMITE = num("limite", Number.MAX_SAFE_INTEGER);
const FORCE = flag("force");
const FORCER_ALIGNEMENT = flag("forcer-alignement");
const APPLIQUER = flag("appliquer");
const CORRESP_WIKI = flag("wikipedia");
const RECALER = flag("recaler");
const BXC_CLI = process.env.BXC_CLI ?? join(userHome(), "bxc/src/cli/index.ts");
const BOT_LOCAL = process.env.SHENRON_BOT_URL ?? "http://127.0.0.1:5006";

const MAX_OCTETS = 2 * 1024 * 1024; // même plafond que /api/assets/upload-subtitle
const PAUSE_MS = 700; // le dépôt est bénévole : on ne le martèle pas
const SEUIL_JAPONAIS = 0.3;

const RE_SOUS_TITRE = /\.(srt|vtt|ass)$/i;
const RE_JAPONAIS = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const RE_KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const RE_LETTRE = /\p{L}/u;

if (!/^[a-z]{2,5}(-[a-z]{2,5})?$/.test(LANG)) {
	console.error(`✗ lang invalide : ${LANG} (attendu « ja », « fr », « fr-fr »…)`);
	process.exit(1);
}

type Fichier = { nom: string; url: string };
type Candidat = Fichier & { rang: number };
type Piste = { lang?: string; label?: string; src?: string };
type Prepare = { contenu: string; ext: ".srt" | ".vtt"; ko: number; part: number; converti: boolean };

/** Une série refusée n'est pas un plantage : code 2, message explicite. */
class Refus extends Error {}

// ── Noms de fichiers ────────────────────────────────────────────────────────

function desEntites(s: string): string {
	return s
		.replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

/**
 * Le numéro sort du NOM, jamais du rang dans la liste — et jamais d'une
 * numérotation relative à une saison.
 *
 * Conventions relevées le 2026-09-13, et ce qu'elles coûtent si on les lit mal :
 *
 *   entrée 1019 (DBS)  « ドラゴンボール超.S01E001.第1話 … »    S01E001 == 第1話
 *   entrée  603 (DBZ)  « ドラゴンボールＺ.S02E01.第36話 … »    S02E01  != 第36話
 *   entrée  603 (DBZ)  « Dragon Ball Z - E001 [TV].srt »       E001 absolu
 *   entrée 1578 (Kai)  « Dragon Ball Kai 095.日本語(CC).srt »  numéro nu
 *
 * Netflix redémarre la numérotation à chaque saison de DBZ : lire `SxxExx`
 * d'abord rangeait l'épisode 36 sous le numéro 1, ~256 pistes sur 291 à la
 * mauvaise fiche. `第N話`, toujours absolu, passe donc en premier ; et un
 * `SxxExx` de saison > 1 sans compteur japonais est refusé, pas deviné.
 */
function numeroDepuisNom(nom: string): number | null {
	const valide = (v: string | undefined) => {
		if (v === undefined) return null;
		const n = Number(v);
		return Number.isInteger(n) && n > 0 && n < 10_000 ? n : null;
	};

	// 1. Compteur japonais : absolu par construction, il prime sur tout.
	const japonais = nom.match(/第\s*(\d{1,4})\s*話/);
	if (japonais) return valide(japonais[1]);

	// Les crochets portent le groupe et la qualité (« [Judas] », « [BD 1080p] ») :
	// les retirer avant de chercher un nombre évite de lire une résolution.
	const sansTags = nom.replace(/\[[^\]]*\]/g, " ").replace(RE_SOUS_TITRE, "");

	// 2. Forme explicite « - E001 » : absolue dans les lots par série entière.
	const explicite = sansTags.match(/(?:^|[\s\-_–])(?:E|EP|ep|Episode|Épisode)\s*0*(\d{1,4})(?=\D|$)/);
	if (explicite) return valide(explicite[1]);

	// 3. `SxxExx` sans compteur japonais : fiable en saison 1 seulement.
	const sxxexx = nom.match(/S(\d{1,3})E(\d{1,4})/i);
	if (sxxexx) return Number(sxxexx[1]) === 1 ? valide(sxxexx[2]) : null;

	// 4. Convention fansub « Titre - 001 ».
	const tiret = sansTags.match(/-\s*0*(\d{1,4})\s*(?:$|[\s._–])/);
	if (tiret) return valide(tiret[1]);

	// 5. Numéro nu suivi d'un point : « Dragon Ball Kai 095.日本語(CC) ».
	//    « 1080p. » ne passe pas, le chiffre doit toucher le point.
	const nu = sansTags.match(/(?:^|\s)0*(\d{1,4})\.(?=\D)/);
	return nu ? valide(nu[1]) : null;
}

/** Ce que le NOM déclare de la langue — sans le lire, on ne tranche pas. */
function marqueLangue(nom: string): "ja" | "autre" | "muet" {
	if (/日本語|japanese|\bjpn\b|\bja\b|ja-jp/i.test(nom) || RE_KANA.test(nom)) return "ja";
	// Les codes à deux lettres ne comptent qu'encadrés (« .en. », « [fr] ») :
	// nus, « de » ou « it » sont des mots de titres romanisés (« Kono Yo de »).
	if (/[.[(_-](en|fr|es|pt|de|it|zh|ko)[.\])_-]/i.test(nom)) return "autre";
	if (/\b(eng|english|fre|fra|french|spa|spanish|por|ger|deu|ita|chi|chs|cht|kor)\b/i.test(nom)) {
		return "autre";
	}
	return "muet";
}

/** Plus bas = préféré. Les sources d'éditeur passent avant les fansubs. */
function rangEditeur(nom: string): number {
	const n = nom.toLowerCase();
	if (n.includes("netflix")) return 0;
	if (n.includes("amazon") || n.includes("prime")) return 1;
	if (/第\s*\d+\s*話/.test(nom)) return 2;
	if (n.includes("[bd") || n.includes("bd ")) return 3;
	return 4;
}

function rangCandidat(nom: string): number {
	const ext = nom.toLowerCase().match(RE_SOUS_TITRE)?.[1];
	const rangExt = ext === "srt" ? 0 : ext === "vtt" ? 1 : 2; // un .ass coûte une conversion
	return (marqueLangue(nom) === "ja" ? 0 : 100) + rangEditeur(nom) * 10 + rangExt;
}

// ── Accès jimaku ────────────────────────────────────────────────────────────

let accesAnnonce = false;

async function listerFichiers(entree: number): Promise<Fichier[]> {
	const cle = process.env.JIMAKU_API_KEY?.trim();
	if (!accesAnnonce) {
		console.log(
			cle
				? "  accès : API officielle (JIMAKU_API_KEY)"
				: "  accès : page publique (JIMAKU_API_KEY absente — l'API répond 401 sans clé)"
		);
		accesAnnonce = true;
	}
	if (cle) {
		const r = await fetch(`${BASE}/api/entries/${entree}/files`, {
			headers: { Authorization: cle, Accept: "application/json", "User-Agent": UA },
		});
		if (!r.ok) throw new Error(`API jimaku ${r.status} (entrée ${entree})`);
		const brut = (await r.json()) as { name?: string; url?: string }[];
		return brut.flatMap((f) => (f.name && f.url ? [{ nom: f.name, url: f.url }] : []));
	}
	const r = await fetch(`${BASE}/entry/${entree}`, { headers: { "User-Agent": UA } });
	if (!r.ok) throw new Error(`page jimaku ${r.status} (entrée ${entree})`);
	const html = await r.text();
	const prefixe = `/entry/${entree}/download/`;
	const vus = new Set<string>();
	const fichiers: Fichier[] = [];
	for (const m of html.matchAll(/href="([^"]+)"/g)) {
		const href = desEntites(m[1]);
		if (!href.startsWith(prefixe) || vus.has(href)) continue;
		vus.add(href);
		const brut = href.slice(prefixe.length);
		let nom = brut;
		try {
			nom = decodeURIComponent(brut);
		} catch {
			// nom déjà décodé ou mal encodé : on garde la forme brute
		}
		fichiers.push({ nom, url: `${BASE}${href}` });
	}
	return fichiers;
}

async function telecharger(url: string, referer: string): Promise<Uint8Array> {
	const r = await fetch(url, { headers: { "User-Agent": UA, Referer: referer } });
	if (!r.ok) throw new Error(`HTTP ${r.status}`);
	const buf = new Uint8Array(await r.arrayBuffer());
	if (buf.byteLength === 0) throw new Error("fichier vide");
	if (buf.byteLength > MAX_OCTETS) {
		throw new Error(`${Math.round(buf.byteLength / 1024)} Ko > plafond 2 Mo`);
	}
	return buf;
}

function decoder(buf: Uint8Array): string {
	if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
	if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
	} catch {
		// Une partie des vieux fichiers japonais est en Shift_JIS.
		return new TextDecoder("shift_jis").decode(buf);
	}
}

// ── Conversion ASS → SRT ────────────────────────────────────────────────────

function tempsAss(t: string): number | null {
	const m = t.trim().match(/^(\d+):(\d{1,2}):(\d{1,2})[.:](\d{1,3})$/);
	if (!m) return null;
	const [, h, min, s, frac] = m;
	// « 12 » en ASS vaut 12 centièmes, soit 120 ms.
	const ms = Number(frac.padEnd(3, "0").slice(0, 3));
	return ((Number(h) * 60 + Number(min)) * 60 + Number(s)) * 1000 + ms;
}

function tempsSrt(ms: number): string {
	const p = (n: number, l = 2) => String(n).padStart(l, "0");
	const h = Math.floor(ms / 3_600_000);
	const m = Math.floor((ms % 3_600_000) / 60_000);
	const s = Math.floor((ms % 60_000) / 1000);
	return `${p(h)}:${p(m)}:${p(s)},${p(ms % 1000, 3)}`;
}

function assVersSrt(ass: string): string {
	let format: string[] | null = null;
	let dansEvents = false;
	const repliques: { debut: number; fin: number; texte: string }[] = [];

	for (const brute of ass.split(/\r?\n/)) {
		const ligne = brute.trim();
		if (/^\[.*\]$/.test(ligne)) {
			dansEvents = ligne.toLowerCase() === "[events]";
			continue;
		}
		if (!dansEvents) continue;
		if (/^format\s*:/i.test(ligne)) {
			format = ligne
				.slice(ligne.indexOf(":") + 1)
				.split(",")
				.map((c) => c.trim().toLowerCase());
			continue;
		}
		if (!format || !/^dialogue\s*:/i.test(ligne)) continue;

		// Le texte est le dernier champ et peut contenir des virgules.
		const champs = ligne.slice(ligne.indexOf(":") + 1).trimStart().split(",");
		if (champs.length < format.length) continue;
		const valeurs = [...champs.slice(0, format.length - 1), champs.slice(format.length - 1).join(",")];
		const champ = (cle: string) => valeurs[format?.indexOf(cle) ?? -1] ?? "";

		const brut = champ("text");
		if (/\{[^}]*\\p[1-9]/.test(brut)) continue; // dessin vectoriel, pas une réplique
		const texte = brut
			.replace(/\{[^}]*\}/g, "")
			.replace(/\\N/gi, "\n")
			.replace(/\\h/g, " ")
			.trim();
		const debut = tempsAss(champ("start"));
		const fin = tempsAss(champ("end"));
		if (!texte || debut === null || fin === null || fin <= debut) continue;
		repliques.push({ debut, fin, texte });
	}

	return repliques
		.toSorted((a, b) => a.debut - b.debut)
		.map((r, i) => `${i + 1}\n${tempsSrt(r.debut)} --> ${tempsSrt(r.fin)}\n${r.texte}\n`)
		.join("\n");
}

/** Part de kana/kanji parmi les lettres, minutage et balises exclus. */
function partJaponais(texte: string): number {
	const utile = texte
		.replace(/\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/g, "")
		.replace(/<[^>]+>/g, "")
		.replace(/^WEBVTT.*$/m, "");
	let japonais = 0;
	let lettres = 0;
	for (const c of utile) {
		if (RE_JAPONAIS.test(c)) {
			japonais++;
			lettres++;
		} else if (RE_LETTRE.test(c)) {
			lettres++;
		}
	}
	return lettres ? japonais / lettres : 0;
}

async function preparer(c: Fichier, referer: string): Promise<Prepare> {
	const buf = await telecharger(c.url, referer);
	let texte = decoder(buf).replace(/\r\n?/g, "\n");
	let ext: ".srt" | ".vtt" = ".srt";
	const converti = c.nom.toLowerCase().endsWith(".ass");
	if (converti) {
		texte = assVersSrt(texte);
		if (!texte.trim()) throw new Error("ASS sans réplique exploitable");
	} else if (c.nom.toLowerCase().endsWith(".vtt")) {
		ext = ".vtt";
	}
	const part = partJaponais(texte);
	if (part < SEUIL_JAPONAIS) {
		throw new Error(`${Math.round(part * 100)} % de japonais — piste d'une autre langue`);
	}
	return { contenu: texte, ext, ko: Math.round(buf.byteLength / 1024), part, converti };
}

/** Essaie les candidats dans l'ordre de préférence jusqu'au premier valide. */
async function premierValide(
	candidats: Candidat[],
	referer: string
): Promise<{ prep: Prepare; retenu: Candidat } | { erreurs: string[] }> {
	const erreurs: string[] = [];
	for (const c of candidats) {
		try {
			return { prep: await preparer(c, referer), retenu: c };
		} catch (err) {
			erreurs.push(`${c.nom.slice(0, 60)} : ${(err as Error).message}`);
		}
	}
	return { erreurs };
}

// ── Base ────────────────────────────────────────────────────────────────────

let provenanceFaite = false;

async function enregistrerProvenance(sql: Sql) {
	if (provenanceFaite) return;
	// `requires_attribution` et `share_alike` sont des BIGINT : ces tables
	// miroitent le SQLite du bot, où un booléen vaut 0/1. `true` échoue en 42804.
	await sql`
		insert into bot.db_licenses (key, name, url, requires_attribution, share_alike)
		values (${LICENSE_KEY}, 'Fair use éditorial fan-site (non commercial)', 'https://dbfr.vercel.app/licence', 1, 0)
		on conflict (key) do nothing`;
	await sql`
		insert into bot.db_sources (id, name, url, license_key, attribution_template)
		values (${SOURCE.id}, ${SOURCE.name}, ${SOURCE.url}, ${LICENSE_KEY}, ${ATTRIBUTION})
		on conflict (id) do update
		   set name = excluded.name,
		       url = excluded.url,
		       license_key = excluded.license_key,
		       attribution_template = excluded.attribution_template`;
	console.log(`  provenance enregistrée : db_sources.${SOURCE.id} (${LICENSE_KEY})`);
	provenanceFaite = true;
}

async function deposer(
	sql: Sql,
	table: "db_episodes" | "db_movies",
	id: number,
	pistes: Piste[],
	prep: Prepare
) {
	await enregistrerProvenance(sql);
	const rel = `assets/subtitles/${table}/${id}/${LANG}${prep.ext}`;
	const abs = join(ROOT, rel);
	await mkdir(dirname(abs), { recursive: true });
	await Bun.write(abs, prep.contenu);

	const majs = [
		...pistes.filter((p) => p.lang?.toLowerCase() !== LANG),
		{ lang: LANG, label: `${LANG.toUpperCase()} — ${SOURCE.name}`, src: `./${rel}` },
	];
	// Deux requêtes explicites plutôt qu'un identifiant dynamique : la table est
	// l'unique paramètre qui ne doit JAMAIS venir d'une entrée utilisateur.
	if (table === "db_episodes") {
		await sql`update bot.db_episodes set subtitles = ${sql.json(majs)} where id = ${id}`;
	} else {
		await sql`update bot.db_movies set subtitles = ${sql.json(majs)} where id = ${id}`;
	}
}

const court = (n: number) => String(n).padStart(3, "0");

// ── Séries ──────────────────────────────────────────────────────────────────

async function modeSeries(sql: Sql) {
	console.log(`jimaku entrée ${ENTRY} → ${SERIES}, piste « ${LANG} »${APPLIQUER ? "" : " (SIMULATION)"}`);

	const fichiers = await listerFichiers(ENTRY);
	const parEpisode = new Map<number, Candidat[]>();
	const ecartes: string[] = [];
	let etrangers = 0;
	for (const f of fichiers) {
		if (!RE_SOUS_TITRE.test(f.nom)) {
			ecartes.push(`${f.nom} (format non pris en charge)`);
			continue;
		}
		if (marqueLangue(f.nom) === "autre") {
			etrangers++;
			continue;
		}
		const ep = numeroDepuisNom(f.nom);
		if (ep === null) {
			ecartes.push(`${f.nom} (aucun numéro d'épisode lisible)`);
			continue;
		}
		const liste = parEpisode.get(ep) ?? [];
		liste.push({ nom: f.nom, url: f.url, rang: rangCandidat(f.nom) });
		parEpisode.set(ep, liste);
	}
	for (const [ep, liste] of parEpisode) parEpisode.set(ep, liste.toSorted((a, b) => a.rang - b.rang));

	if (ecartes.length) {
		console.log(`  ${ecartes.length} fichier(s) écarté(s) :`);
		for (const e of ecartes.slice(0, 6)) console.log(`    · ${e}`);
		if (ecartes.length > 6) console.log(`    · … et ${ecartes.length - 6} autre(s)`);
	}
	if (etrangers) console.log(`  ${etrangers} piste(s) déclarée(s) dans une autre langue, écartée(s)`);
	if (!parEpisode.size) throw new Refus("aucun fichier exploitable sur cette entrée");

	const numeros = [...parEpisode.keys()].toSorted((a, b) => a - b);
	const conversions = [...parEpisode.values()].filter((l) => l[0].nom.toLowerCase().endsWith(".ass")).length;
	console.log(
		`  ${parEpisode.size} épisode(s) disponible(s) : ${numeros[0]} → ${numeros.at(-1)}` +
			(conversions ? ` · ${conversions} à convertir depuis ASS` : "")
	);

	const episodes = await sql<{ id: number; number_in_series: number; subtitles: unknown }[]>`
		select id, number_in_series, subtitles from bot.db_episodes
		 where series = ${SERIES} order by number_in_series`;
	if (!episodes.length) throw new Refus(`aucun épisode en base pour la série ${SERIES}`);
	const parNumero = new Map(episodes.map((e) => [Number(e.number_in_series), e]));
	console.log(`  ${episodes.length} épisode(s) ${SERIES} en base`);

	// Garde d'alignement — même arbitrage que `crawl-frames.ts`.
	if (parEpisode.size !== episodes.length) {
		const message =
			`alignement douteux : ${parEpisode.size} épisode(s) sur jimaku contre ` +
			`${episodes.length} en base pour ${SERIES}`;
		if (!FORCER_ALIGNEMENT) throw new Refus(`${message} — série écartée (--forcer-alignement pour passer outre)`);
		console.log(`  ⚠ ${message} — forcé par --forcer-alignement`);
	}

	let deposes = 0;
	let sautes = 0;
	let absents = 0;
	let echecs = 0;

	for (const numero of numeros) {
		if (numero < DE || numero > A) continue;
		if (deposes + sautes >= LIMITE) break;
		const ep = parNumero.get(numero);
		if (!ep) {
			absents++;
			continue;
		}
		const pistes = Array.isArray(ep.subtitles) ? (ep.subtitles as Piste[]) : [];
		if (!FORCE && pistes.some((p) => p.lang?.toLowerCase() === LANG)) {
			sautes++;
			continue;
		}
		const candidats = parEpisode.get(numero) ?? [];

		if (!APPLIQUER) {
			console.log(`  ep ${court(numero)} → #${ep.id}  ${candidats[0].nom.slice(0, 70)}`);
			deposes++;
			continue;
		}

		const essai = await premierValide(candidats, `${BASE}/entry/${ENTRY}`);
		if ("erreurs" in essai) {
			console.log(`  ✗ ep ${court(numero)} : ${essai.erreurs.join(" | ")}`);
			echecs++;
		} else {
			try {
				await deposer(sql, "db_episodes", ep.id, pistes, essai.prep);
				console.log(
					`  ✓ ep ${court(numero)} → #${ep.id}  ${essai.prep.ko} Ko · ` +
						`${Math.round(essai.prep.part * 100)} % ja${essai.prep.converti ? " · ASS converti" : ""}`
				);
				deposes++;
			} catch (err) {
				console.log(`  ✗ ep ${court(numero)} : ${(err as Error).message}`);
				echecs++;
			}
		}
		await Bun.sleep(PAUSE_MS);
	}

	console.log(
		`\n${deposes} piste(s) ${APPLIQUER ? "déposée(s)" : "à déposer"} · ${sautes} déjà présente(s) · ` +
			`${absents} sans épisode correspondant en base · ${echecs} échec(s)`
	);
}

// ── Correspondance par table (Kai Final) ────────────────────────────────────

/** Instant de la dernière réplique, en millisecondes. */
function finDesRepliques(texte: string): number {
	let fin = 0;
	for (const m of texte.matchAll(/-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/g)) {
		const ms = ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
		if (ms > fin) fin = ms;
	}
	return fin;
}

/** Durée d'un média lisible directement par ffprobe (MP4), ou null. */
async function dureeFfprobe(url: string): Promise<number | null> {
	const proc = Bun.spawn(
		["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", url],
		{ stdout: "pipe", stderr: "ignore" }
	);
	const minuteur = setTimeout(() => proc.kill(), 90_000);
	const sortie = await new Response(proc.stdout).text();
	await proc.exited;
	clearTimeout(minuteur);
	const secondes = Number(sortie.trim());
	return Number.isFinite(secondes) && secondes > 0 ? Math.round(secondes * 1000) : null;
}

/**
 * Durée de la vidéo VOSTFR servie par le proxy HLS du bot, ou null.
 *
 * Pas ffprobe pour le HLS : les segments du proxy sont des URL
 * `/api/hls/<id>/seg?u=…` sans extension, que le démultiplexeur HLS de ffmpeg
 * refuse (« not in allowed_segment_extensions »). On lit la playlist : maître →
 * première variante → somme des #EXTINF, à condition qu'elle soit CLOSE
 * (#EXT-X-ENDLIST). Un MP4 servi sous la même URL passe par ffprobe.
 */
async function dureeVideoMs(episodeId: number): Promise<number | null> {
	const maitre = `${BOT_LOCAL}/api/hls/${episodeId}/master.m3u8?lang=vostfr`;
	try {
		const r = await fetch(maitre, { signal: AbortSignal.timeout(90_000) });
		if (!r.ok) return null;
		if (!/mpegurl/i.test(r.headers.get("content-type") ?? "")) {
			await r.body?.cancel();
			return await dureeFfprobe(maitre);
		}
		let playlist = await r.text();
		if (!playlist.includes("#EXTINF")) {
			const variante = playlist
				.split("\n")
				.map((ligne) => ligne.trim())
				.find((ligne) => ligne && !ligne.startsWith("#"));
			if (!variante) return null;
			const rv = await fetch(new URL(variante, maitre), { signal: AbortSignal.timeout(90_000) });
			if (!rv.ok) return null;
			playlist = await rv.text();
		}
		if (!playlist.includes("#EXT-X-ENDLIST")) return null;
		let secondes = 0;
		for (const m of playlist.matchAll(/#EXTINF:\s*([\d.]+)/g)) secondes += Number(m[1]);
		return secondes > 0 ? Math.round(secondes * 1000) : null;
	} catch {
		return null;
	}
}

/** Capture une image du flux VOSTFR (proxy du bot) à l'instant donné. */
async function captureImage(episodeId: number, secondes: number, sortie: string): Promise<boolean> {
	const proc = Bun.spawn(
		[
			"ffmpeg",
			"-v",
			"error",
			"-y",
			// Les segments du proxy n'ont pas d'extension : ffmpeg ≥ 8 les refuse sans ce drapeau.
			"-extension_picky",
			"0",
			"-ss",
			String(secondes),
			"-i",
			`${BOT_LOCAL}/api/hls/${episodeId}/master.m3u8?lang=vostfr`,
			"-frames:v",
			"1",
			"-q:v",
			"3",
			sortie,
		],
		{ stdout: "ignore", stderr: "ignore" }
	);
	const minuteur = setTimeout(() => proc.kill(), 120_000);
	const code = await proc.exited;
	clearTimeout(minuteur);
	return code === 0 && Bun.file(sortie).size > 0;
}

/**
 * Instant (ms) de Kai (2014) épisode `k` que trace.moe reconnaît sur l'image, ou
 * null. Pas de seuil de similarité : sur une image tirée d'une vidéo recompressée,
 * trace.moe désigne le bon épisode dès 0,55 (mesuré le 2026-09-13). La preuve
 * tient à la CONCORDANCE de deux sondes indépendantes (cf. `recaler`), qu'un
 * faux positif ne produit pas.
 */
async function instantJaponais(image: string, k: number): Promise<number | null> {
	const proc = Bun.spawn(["bun", BXC_CLI, "frames", "search", image, "--remote", "--limit", "5", "--json"], {
		stdout: "pipe",
		stderr: "ignore",
	});
	const minuteur = setTimeout(() => proc.kill(), 120_000);
	const sortie = await new Response(proc.stdout).text();
	await proc.exited;
	clearTimeout(minuteur);
	try {
		const data = JSON.parse(sortie) as {
			matches?: { title?: string; episode?: number | null; atMs?: number }[];
		};
		const vu = (data.matches ?? []).find(
			(m) => /kai/i.test(m.title ?? "") && m.episode === k && typeof m.atMs === "number"
		);
		return vu?.atMs ?? null;
	} catch {
		return null;
	}
}

/** Décale toutes les répliques d'un SRT ; celles qui finiraient avant 0 disparaissent. */
function decalerSrt(srt: string, deltaMs: number): string {
	const lire = (h: string, m: string, sec: string, ms: string) =>
		((Number(h) * 60 + Number(m)) * 60 + Number(sec)) * 1000 + Number(ms);
	const sortie: string[] = [];
	for (const bloc of srt.split(/\n\s*\n/)) {
		const lignes = bloc.split("\n");
		const i = lignes.findIndex((l) => l.includes("-->"));
		if (i < 0) continue;
		const m = lignes[i].match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/);
		if (!m) continue;
		const debut = lire(m[1], m[2], m[3], m[4]) + deltaMs;
		const fin = lire(m[5], m[6], m[7], m[8]) + deltaMs;
		const texte = lignes.slice(i + 1).join("\n").trim();
		if (fin <= 0 || !texte) continue;
		sortie.push(`${sortie.length + 1}\n${tempsSrt(Math.max(0, debut))} --> ${tempsSrt(fin)}\n${texte}\n`);
	}
	return sortie.join("\n");
}

/**
 * Recalage d'une piste dont la dernière réplique DÉPASSE la fin de la vidéo.
 *
 * Après réalignement des lecteurs (2026-09-13), 6 fiches Kai Final dépassaient
 * de 13 à 44 s. La durée seule ne distingue pas deux causes opposées : une vidéo
 * amputée de sa FIN (carton final — la piste est bonne) ou de son DÉBUT (tout est
 * décalé). trace.moe le distingue : deux sondes au cœur de l'épisode doivent
 * désigner Kai (2014) ép. k (n° jimaku − 98) et le même décalage à 1,5 s près.
 * Décalage ≤ 3 s : début calé, piste inchangée. Jusqu'à 60 s : répliques décalées
 * d'autant. Au-delà, ou à la moindre incohérence : piste écartée.
 */
async function recaler(
	episodeId: number,
	jp: number,
	contenu: string
): Promise<{ contenu: string; detail: string } | { raison: string }> {
	const k = jp - 98;
	if (k < 1) return { raison: "épisode hors de Kai (2014)" };
	// Deux sondes suffisent ; deux autres restent en réserve, car une image peut
	// tomber sur un fondu, un eyecatch ou un plan fixe que trace.moe ne situe pas
	// (fiches 27 et 43, 2026-09-13). La concordance porte toujours sur les deux
	// premières sondes abouties.
	const decalages: number[] = [];
	const rates: string[] = [];
	for (const secondes of [480, 960, 720, 1140]) {
		if (decalages.length === 2) break;
		const image = `/tmp/kai-recalage-${episodeId}-${secondes}.jpg`;
		if (!(await captureImage(episodeId, secondes, image))) {
			rates.push(`capture ${secondes} s`);
			continue;
		}
		const atMs = await instantJaponais(image, k);
		if (atMs === null) {
			rates.push(`non situé à ${secondes} s`);
			continue;
		}
		decalages.push(atMs - secondes * 1000);
	}
	if (decalages.length < 2) return { raison: `trace.moe ne situe pas Kai (2014) ép. ${k} (${rates.join(", ")})` };
	const [a, b] = decalages;
	const s1 = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
	if (Math.abs(a - b) > 1_500) return { raison: `décalages incohérents (${s1(a)} / ${s1(b)})` };
	const decalage = Math.round((a + b) / 2);
	if (Math.abs(decalage) > 60_000) return { raison: `décalage de ${s1(decalage)}, hors tolérance` };
	if (Math.abs(decalage) <= 3_000) return { contenu, detail: `début calé (${s1(decalage)}), fin de vidéo rognée` };
	return { contenu: decalerSrt(contenu, -decalage), detail: `répliques décalées de ${s1(-decalage)}` };
}

/**
 * Kai Final par table de correspondance fiche → épisode japonais.
 *
 * La table (`data/kai-final-correspondance.json`, cf. kai-final-correspondance.ts)
 * place 59 fiches sur 70 : 51 par titre de diffusion japonais, 8 par interpolation
 * à pas égal. Elle a longtemps vécu ici, calculée à la volée — et appliquée alors
 * que les lecteurs VOSTFR suivaient une AUTRE numérotation (97 + n, héritée de
 * l'import) : 33 pistes déposées par titre défilaient sur un autre épisode et ont
 * été retirées le 2026-09-13. Une piste s'affiche sur la VIDÉO ; on ne dépose donc
 * que si la table porte `lecteursRealignes: true`, posé par
 * kai-final-realigner-vostfr.ts une fois la VOSTFR de chaque fiche replacée.
 */
async function modeCorrespondance(sql: Sql) {
	console.log(
		`jimaku → ${SERIES} par table de correspondance, piste « ${LANG} »${APPLIQUER ? "" : " (SIMULATION)"}`
	);
	if (SERIES !== "DBZ_KAI_FINAL") {
		throw new Refus("--wikipedia ne vaut que pour DBZ_KAI_FINAL, seule série dotée d'une table");
	}
	const table = (await Bun.file(join(ROOT, "data", "kai-final-correspondance.json")).json()) as {
		lecteursRealignes?: boolean;
		entrees: { n: number; jp: number; methode: string }[];
	};
	if (!table.lecteursRealignes) {
		throw new Refus(
			"lecteurs VOSTFR pas encore réalignés sur la table — lancer kai-final-realigner-vostfr.ts --appliquer d'abord"
		);
	}
	const correspondance = new Map(table.entrees.map((e) => [e.n, e.jp]));
	console.log(
		`  table : ${correspondance.size} fiches placées, dont ` +
			`${table.entrees.filter((e) => e.methode === "interpolation").length} par interpolation`
	);

	const episodes = await sql<{ id: number; number_in_series: number; subtitles: unknown }[]>`
		select id, number_in_series, subtitles from bot.db_episodes
		 where series = ${SERIES} order by number_in_series`;
	if (!episodes.length) throw new Refus(`aucun épisode en base pour la série ${SERIES}`);

	const parNumero = new Map<number, Candidat[]>();
	for (const entree of [ENTRY, ...(ENTREES_COMPLEMENT[SERIES] ?? [])]) {
		for (const f of await listerFichiers(entree)) {
			if (!RE_SOUS_TITRE.test(f.nom) || marqueLangue(f.nom) === "autre") continue;
			const numero = numeroDepuisNom(f.nom);
			if (numero === null) continue;
			const liste = parNumero.get(numero) ?? [];
			liste.push({ nom: f.nom, url: f.url, rang: rangCandidat(f.nom) });
			parNumero.set(numero, liste);
		}
	}
	for (const [numero, liste] of parNumero) parNumero.set(numero, liste.toSorted((a, b) => a.rang - b.rang));

	let deposes = 0;
	let sautes = 0;
	let absents = 0;
	let echecs = 0;
	for (const e of episodes) {
		const n = Number(e.number_in_series);
		if (n < DE || n > A) continue;
		if (deposes + sautes >= LIMITE) break;
		const jp = correspondance.get(n);
		if (jp === undefined) continue;
		const candidats = parNumero.get(jp);
		if (!candidats?.length) {
			absents++;
			continue;
		}
		const pistes = Array.isArray(e.subtitles) ? (e.subtitles as Piste[]) : [];
		if (!FORCE && pistes.some((p) => p.lang?.toLowerCase() === LANG)) {
			sautes++;
			continue;
		}
		if (!APPLIQUER) {
			console.log(`  ep ${court(n)} ← n° JP ${jp} → #${e.id}  ${candidats[0].nom.slice(0, 56)}`);
			deposes++;
			continue;
		}

		const essai = await premierValide(candidats, `${BASE}/entry/${ENTRY}`);
		if ("erreurs" in essai) {
			console.log(`  ✗ ep ${court(n)} : ${essai.erreurs.join(" | ")}`);
			echecs++;
			await Bun.sleep(PAUSE_MS);
			continue;
		}
		// La table établit QUEL épisode ; la durée vérifie qu'il s'agit du même
		// montage — la dernière réplique doit tomber dans les trois dernières
		// minutes de la vidéo VOSTFR.
		const fin = finDesRepliques(essai.prep.contenu);
		const video = await dureeVideoMs(e.id);
		if (video === null) {
			console.log(`  ✗ ep ${court(n)} : durée de la vidéo VOSTFR inconnue — piste non déposée`);
			echecs++;
			continue;
		}
		let prep = essai.prep;
		let note = `fin ${Math.round(fin / 1000)} s / vidéo ${Math.round(video / 1000)} s`;
		if (fin > video + 5_000 || video - fin > 180_000) {
			const recalable = RECALER && prep.ext === ".srt" && fin > video + 5_000 && fin - video <= 60_000;
			const recal = recalable ? await recaler(e.id, jp, prep.contenu) : null;
			if (!recal || "raison" in recal) {
				console.log(
					`  ✗ ep ${court(n)} : répliques jusqu'à ${Math.round(fin / 1000)} s pour une vidéo de ` +
						`${Math.round(video / 1000)} s — montage différent${recal ? ` (${recal.raison})` : ""}, piste non déposée`
				);
				echecs++;
				continue;
			}
			prep = { ...prep, contenu: recal.contenu };
			note = `${note} · recalage : ${recal.detail}`;
		}
		try {
			await deposer(sql, "db_episodes", e.id, pistes, prep);
			console.log(`  ✓ ep ${court(n)} ← n° JP ${jp} → #${e.id}  ${prep.ko} Ko · ${note}`);
			deposes++;
		} catch (err) {
			console.log(`  ✗ ep ${court(n)} : ${(err as Error).message}`);
			echecs++;
		}
		await Bun.sleep(PAUSE_MS);
	}

	console.log(
		`\n${deposes} piste(s) ${APPLIQUER ? "déposée(s)" : "à déposer"} · ${sautes} déjà présente(s) · ` +
			`${absents} sans fichier jimaku · ${echecs} échec(s)`
	);
}

// ── Films ───────────────────────────────────────────────────────────────────

/** Clé de comparaison d'un titre romanisé, identique des deux côtés. */
function cleTitre(t: string): string {
	return desEntites(t)
		.normalize("NFKC")
		.toLowerCase()
		.replace(/\b(movie|film|special|ova)\s*\d*\b/g, " ")
		.replace(/[^a-z0-9]+/g, "")
		.replace(/ou|oo/g, "o")
		.replace(/uu/g, "u")
		.replace(/aa/g, "a")
		.replace(/ii/g, "i")
		.replace(/ee/g, "e");
}

type Film = { id: number; titre: string; cle: string; pistes: Piste[] };

function apparier(titre: string, films: Film[]): { film: Film | null; raison: string } {
	const cle = cleTitre(titre);
	const exacts = films.filter((f) => f.cle === cle);
	if (exacts.length === 1) return { film: exacts[0], raison: "titre identique" };
	if (exacts.length > 1) return { film: null, raison: `${exacts.length} films au titre identique` };
	// Un titre qui en prolonge un autre (« Tatta Hitori no Saishuu Kessen » et
	// sa version longue « … - Freeza ni Idonda Z Senshi … »). 18 caractères au
	// moins : en dessous, « Dragon Ball Z » seul prolongerait tout le catalogue.
	const prolonges = films.filter(
		(f) => Math.min(f.cle.length, cle.length) >= 18 && (cle.startsWith(f.cle) || f.cle.startsWith(cle))
	);
	if (prolonges.length === 1) return { film: prolonges[0], raison: "titre prolongé" };
	return {
		film: null,
		raison: prolonges.length ? `${prolonges.length} films candidats, aucun départage` : "aucun film correspondant",
	};
}

async function modeFilms(sql: Sql) {
	console.log(`jimaku films → db_movies, piste « ${LANG} »${APPLIQUER ? "" : " (SIMULATION)"}`);

	const r = await fetch(`${BASE}/`, { headers: { "User-Agent": UA } });
	if (!r.ok) throw new Error(`catalogue jimaku ${r.status}`);
	const html = await r.text();
	const series = new Set(Object.values(ENTREES));
	const entrees = new Map<number, string>();
	for (const m of html.matchAll(/href="\/entry\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g)) {
		const id = Number(m[1]);
		const titre = desEntites(m[2].replace(/<[^>]+>/g, "")).trim();
		if (!titre || series.has(id) || entrees.has(id)) continue;
		if (/dragon\s*ball/i.test(titre)) entrees.set(id, titre);
	}
	console.log(`  ${entrees.size} entrée(s) « Dragon Ball » hors séries au catalogue`);

	const lignes = await sql<{ id: number; title: string; title_romaji: string | null; subtitles: unknown }[]>`
		select id, title, title_romaji, subtitles from bot.db_movies order by id`;
	const films: Film[] = lignes.map((l) => ({
		id: l.id,
		titre: l.title,
		cle: cleTitre(l.title_romaji ?? l.title),
		pistes: Array.isArray(l.subtitles) ? (l.subtitles as Piste[]) : [],
	}));
	console.log(`  ${films.length} film(s) en base`);

	let deposes = 0;
	let sautes = 0;
	let nonApparies = 0;
	let echecs = 0;

	for (const [id, titre] of entrees) {
		if (deposes + sautes >= LIMITE) break;
		const { film, raison } = apparier(titre, films);
		if (!film) {
			console.log(`  ✗ ${id} « ${titre} » : ${raison}`);
			nonApparies++;
			continue;
		}
		if (!FORCE && film.pistes.some((p) => p.lang?.toLowerCase() === LANG)) {
			sautes++;
			continue;
		}

		const candidats = (await listerFichiers(id))
			.filter((f) => RE_SOUS_TITRE.test(f.nom) && marqueLangue(f.nom) !== "autre")
			.map((f) => ({ nom: f.nom, url: f.url, rang: rangCandidat(f.nom) }))
			.toSorted((a, b) => a.rang - b.rang);
		if (!candidats.length) {
			console.log(`  ✗ ${id} → #${film.id} « ${film.titre} » : aucun sous-titre exploitable`);
			echecs++;
			continue;
		}

		if (!APPLIQUER) {
			console.log(`  ${id} → #${film.id} « ${film.titre} » (${raison}) · ${candidats[0].nom.slice(0, 60)}`);
			deposes++;
		} else {
			const essai = await premierValide(candidats, `${BASE}/entry/${id}`);
			if ("erreurs" in essai) {
				console.log(`  ✗ ${id} → #${film.id} : ${essai.erreurs.join(" | ")}`);
				echecs++;
			} else {
				try {
					await deposer(sql, "db_movies", film.id, film.pistes, essai.prep);
					console.log(
						`  ✓ ${id} → #${film.id} « ${film.titre} » ${essai.prep.ko} Ko · ` +
							`${Math.round(essai.prep.part * 100)} % ja${essai.prep.converti ? " · ASS converti" : ""}`
					);
					deposes++;
				} catch (err) {
					console.log(`  ✗ ${id} → #${film.id} : ${(err as Error).message}`);
					echecs++;
				}
			}
		}
		await Bun.sleep(PAUSE_MS);
	}

	console.log(
		`\n${deposes} piste(s) ${APPLIQUER ? "déposée(s)" : "à déposer"} · ${sautes} déjà présente(s) · ` +
			`${nonApparies} entrée(s) sans film correspondant · ${echecs} échec(s)`
	);
}

// ── Entrée ──────────────────────────────────────────────────────────────────

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) {
		console.error("✗ DATABASE_URL requis (Neon, via ~/.shenron-neon.env).");
		process.exit(1);
	}
	const sql = postgres(url, { max: 1 });
	try {
		if (FILMS) await modeFilms(sql);
		else if (CORRESP_WIKI) await modeCorrespondance(sql);
		else await modeSeries(sql);
		if (!APPLIQUER) console.log("SIMULATION — relancer avec --appliquer pour écrire.");
	} catch (err) {
		if (err instanceof Refus) {
			console.error(`✗ ${err.message}`);
			process.exitCode = 2;
		} else {
			throw err;
		}
	} finally {
		await sql.end({ timeout: 5 });
	}
}

await main();
