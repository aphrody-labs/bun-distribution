#!/usr/bin/env bun
/**
 * dump-forum-scans.ts — Vidange typée d'un forum Discord de scans.
 *
 * Deux étapes séparées, parce qu'elles n'ont ni le même coût ni le même risque :
 *
 *   1. `index`      — parcourt les fils du forum et TOUS leurs messages, et écrit un
 *                     manifeste (`manifeste.json`). Aucune image n'est téléchargée :
 *                     `attachment.size` suffit à connaître le poids total AVANT d'y
 *                     consacrer du disque.
 *   2. `telecharge` — relit le manifeste et récupère les images, en parallèle borné,
 *                     avec reprise (un fichier déjà présent à la bonne taille est sauté).
 *
 * REST uniquement (pas de gateway) : zéro interférence avec le bot en production.
 *
 *   bun apps/bot/scripts/dump-forum-scans.ts index [--forum <id>] [--sortie <dir>]
 *   bun apps/bot/scripts/dump-forum-scans.ts telecharge [--concurrence 8] [--depuis <n>] [--jusqu-a <n>]
 *   bun apps/bot/scripts/dump-forum-scans.ts etat
 *
 * Jeton : `DISCORD_TOKEN_GRAND_PRETRE` de `apps/bot/.env` (lecture seule côté Discord).
 */

import { mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

const API = "https://discord.com/api/v10";
const FORUM_DEFAUT = "1094723131970703390"; // 📖・scan-db
const RACINE_DEFAUT = new URL("../data/scans-forum", import.meta.url).pathname;

// ── Formes Discord réellement utilisées (partielles, mais typées) ────────────

interface PieceJointe {
	readonly id: string;
	readonly filename: string;
	readonly size: number;
	readonly url: string;
	readonly content_type?: string;
	readonly width?: number;
	readonly height?: number;
}

interface MessageDiscord {
	readonly id: string;
	readonly timestamp: string;
	readonly content: string;
	readonly attachments: readonly PieceJointe[];
	readonly author?: { readonly id: string; readonly username: string };
}

interface FilDiscord {
	readonly id: string;
	readonly name: string;
	readonly parent_id?: string;
	readonly message_count?: number;
	readonly applied_tags?: readonly string[];
	readonly thread_metadata?: { readonly archive_timestamp?: string; readonly archived?: boolean };
}

interface SalonForum {
	readonly id: string;
	readonly name: string;
	readonly available_tags?: readonly { readonly id: string; readonly name: string }[];
}

// ── Manifeste (le contrat entre les deux étapes) ────────────────────────────

interface Planche {
	readonly ordre: number;
	readonly fichier: string;
	readonly url: string;
	readonly taille: number;
	readonly largeur: number | null;
	readonly hauteur: number | null;
	readonly typeMime: string | null;
	readonly messageId: string;
	readonly horodatage: string;
}

interface FilManifeste {
	readonly id: string;
	readonly nom: string;
	readonly dossier: string;
	readonly tags: readonly string[];
	readonly planches: readonly Planche[];
}

interface Manifeste {
	readonly forumId: string;
	readonly forumNom: string;
	readonly genereLe: string;
	readonly fils: readonly FilManifeste[];
}

// ── Socle ───────────────────────────────────────────────────────────────────

const args: readonly string[] = process.argv.slice(2);
const commande = args[0] ?? "index";

function option(nom: string): string | undefined {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 ? args[i + 1] : undefined;
}

function nombre(nom: string, defaut: number): number {
	const brut = option(nom);
	const n = brut === undefined ? Number.NaN : Number(brut);
	return Number.isFinite(n) ? n : defaut;
}

const RACINE = option("sortie") ?? RACINE_DEFAUT;
const CHEMIN_MANIFESTE = join(RACINE, "manifeste.json");

async function jeton(): Promise<string> {
	const direct = process.env.DISCORD_TOKEN_GRAND_PRETRE?.trim();
	if (direct) return direct;
	const chemin = new URL("../.env", import.meta.url).pathname;
	const texte = await Bun.file(chemin)
		.text()
		.catch(() => "");
	const ligne = texte.split("\n").find((l) => l.trim().startsWith("DISCORD_TOKEN_GRAND_PRETRE="));
	const valeur = ligne
		?.split("=")
		.slice(1)
		.join("=")
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) throw new Error("DISCORD_TOKEN_GRAND_PRETRE introuvable (env ou apps/bot/.env)");
	return valeur;
}

const TOKEN = await jeton();

/**
 * Un appel REST qui respecte le 429 plutôt que de le subir : Discord annonce
 * lui-même la durée d'attente, la deviner ne sert à rien.
 */
async function api<T>(chemin: string, essais = 5): Promise<T> {
	for (let essai = 1; ; essai++) {
		const reponse = await fetch(`${API}${chemin}`, {
			headers: { Authorization: `Bot ${TOKEN}` },
		});
		if (reponse.status === 429) {
			const corps = (await reponse.json().catch(() => ({}))) as { retry_after?: number };
			await Bun.sleep(Math.ceil((corps.retry_after ?? 1) * 1000) + 250);
			continue;
		}
		if (!reponse.ok) {
			if (essai >= essais)
				throw new Error(`${chemin} → HTTP ${reponse.status} ${await reponse.text()}`);
			await Bun.sleep(500 * essai);
			continue;
		}
		return (await reponse.json()) as T;
	}
}

/** Parallélisme borné, sur un itérable typé, en préservant l'ordre des résultats. */
async function enParallele<E, S>(
	elements: readonly E[],
	concurrence: number,
	travail: (element: E, index: number) => Promise<S>
): Promise<S[]> {
	const resultats: S[] = Array.from({ length: elements.length }) as S[];
	let curseur = 0;
	const ouvriers = Array.from(
		{ length: Math.max(1, Math.min(concurrence, elements.length)) },
		async () => {
			for (;;) {
				const i = curseur++;
				if (i >= elements.length) return;
				resultats[i] = await travail(elements[i] as E, i);
			}
		}
	);
	await Promise.all(ouvriers);
	return resultats;
}

function slug(nom: string): string {
	return (
		nom
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.replace(/[^a-zA-Z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.toLowerCase()
			.slice(0, 80) || "sans-nom"
	);
}

function extension(nomFichier: string): string {
	const m = /\.([a-z0-9]{2,5})$/i.exec(nomFichier);
	return m ? m[1]!.toLowerCase() : "bin";
}

const IMAGE = /^image\//;
function estImage(p: PieceJointe): boolean {
	if (p.content_type && IMAGE.test(p.content_type)) return true;
	return /\.(jpe?g|png|webp|gif|avif)$/i.test(p.filename);
}

function poids(octets: number): string {
	const u = ["o", "Ko", "Mo", "Go"];
	let v = octets;
	let i = 0;
	while (v >= 1024 && i < u.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

// ── Étape 1 : index ─────────────────────────────────────────────────────────

/** Tous les fils du forum : les actifs, puis les archivés page par page. */
async function tousLesFils(forumId: string): Promise<FilDiscord[]> {
	const salon = await api<{ guild_id: string }>(`/channels/${forumId}`);
	const actifs = await api<{ threads: FilDiscord[] }>(`/guilds/${salon.guild_id}/threads/active`);
	const fils: FilDiscord[] = actifs.threads.filter((f) => f.parent_id === forumId);

	let avant: string | undefined;
	for (;;) {
		const q = new URLSearchParams({ limit: "100" });
		if (avant) q.set("before", avant);
		const page = await api<{ threads: FilDiscord[]; has_more: boolean }>(
			`/channels/${forumId}/threads/archived/public?${q}`
		);
		fils.push(...page.threads);
		const dernier = page.threads.at(-1);
		const ts = dernier?.thread_metadata?.archive_timestamp;
		process.stdout.write(`\r[index] fils découverts : ${fils.length}`);
		if (!page.has_more || !ts) break;
		avant = ts;
	}
	process.stdout.write("\n");
	return fils;
}

/** L'historique complet d'un fil, du plus ancien au plus récent. */
async function messagesDuFil(filId: string): Promise<MessageDiscord[]> {
	const tous: MessageDiscord[] = [];
	let avant: string | undefined;
	for (;;) {
		const q = new URLSearchParams({ limit: "100" });
		if (avant) q.set("before", avant);
		const page = await api<MessageDiscord[]>(`/channels/${filId}/messages?${q}`);
		if (page.length === 0) break;
		tous.push(...page);
		avant = page.at(-1)?.id;
		if (page.length < 100) break;
	}
	// Discord rend du plus récent au plus ancien ; les planches se lisent dans l'autre sens.
	return tous.toReversed();
}

async function indexer(): Promise<Manifeste> {
	const forumId = option("forum") ?? FORUM_DEFAUT;
	const salon = await api<SalonForum>(`/channels/${forumId}`);
	const tags = new Map((salon.available_tags ?? []).map((t) => [t.id, t.name]));
	const fils = await tousLesFils(forumId);

	let faits = 0;
	const construits = await enParallele(fils, nombre("concurrence", 6), async (fil) => {
		const messages = await messagesDuFil(fil.id);
		const planches: Planche[] = [];
		for (const message of messages) {
			for (const piece of message.attachments) {
				if (!estImage(piece)) continue;
				const ordre = planches.length + 1;
				planches.push({
					ordre,
					fichier: `${String(ordre).padStart(3, "0")}-${piece.id}.${extension(piece.filename)}`,
					url: piece.url,
					taille: piece.size,
					largeur: piece.width ?? null,
					hauteur: piece.height ?? null,
					typeMime: piece.content_type ?? null,
					messageId: message.id,
					horodatage: message.timestamp,
				});
			}
		}
		faits++;
		process.stdout.write(`\r[index] fils lus : ${faits}/${fils.length}`);
		return {
			id: fil.id,
			nom: fil.name,
			dossier: `${fil.id}-${slug(fil.name)}`,
			tags: (fil.applied_tags ?? []).map((t) => tags.get(t) ?? t),
			planches,
		} satisfies FilManifeste;
	});
	process.stdout.write("\n");

	// Du plus ancien au plus récent : l'identifiant de fil est un snowflake, donc chronologique.
	const ordonnes = construits.toSorted((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
	const manifeste: Manifeste = {
		forumId,
		forumNom: salon.name,
		genereLe: new Date().toISOString(),
		fils: ordonnes,
	};
	await mkdir(RACINE, { recursive: true });
	await Bun.write(CHEMIN_MANIFESTE, `${JSON.stringify(manifeste, null, "\t")}\n`);
	return manifeste;
}

// ── Étape 2 : téléchargement ────────────────────────────────────────────────

async function lireManifeste(): Promise<Manifeste> {
	const fichier = Bun.file(CHEMIN_MANIFESTE);
	if (!(await fichier.exists()))
		throw new Error(`Manifeste absent : ${CHEMIN_MANIFESTE} (lancer « index » d'abord)`);
	return (await fichier.json()) as Manifeste;
}

interface Cible {
	readonly chemin: string;
	readonly planche: Planche;
	readonly fil: string;
}

async function telecharger(): Promise<void> {
	const manifeste = await lireManifeste();
	const depuis = nombre("depuis", 1);
	const jusqua = nombre("jusqu-a", manifeste.fils.length);
	const retenus = manifeste.fils.slice(depuis - 1, jusqua);

	const cibles: Cible[] = retenus.flatMap((fil) =>
		fil.planches.map((planche) => ({
			chemin: join(RACINE, fil.dossier, planche.fichier),
			planche,
			fil: fil.nom,
		}))
	);
	const total = cibles.reduce((s, c) => s + c.planche.taille, 0);
	console.log(`[dump] ${retenus.length} fils, ${cibles.length} planches, ${poids(total)} annoncés`);

	let ok = 0;
	let saute = 0;
	let echec = 0;
	const echecs: string[] = [];

	await enParallele(cibles, nombre("concurrence", 8), async (cible) => {
		const existant = await stat(cible.chemin).catch(() => null);
		if (existant?.size === cible.planche.taille) {
			saute++;
			return;
		}
		for (let essai = 1; essai <= 4; essai++) {
			try {
				const reponse = await fetch(cible.planche.url);
				if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
				await mkdir(dirname(cible.chemin), { recursive: true });
				await Bun.write(cible.chemin, reponse);
				ok++;
				break;
			} catch (erreur) {
				if (essai === 4) {
					echec++;
					echecs.push(`${cible.fil} :: ${cible.planche.fichier} → ${String(erreur)}`);
					break;
				}
				await Bun.sleep(400 * essai);
			}
		}
		if ((ok + saute + echec) % 25 === 0)
			process.stdout.write(`\r[dump] ${ok} écrites · ${saute} déjà là · ${echec} en échec`);
	});

	process.stdout.write(`\r[dump] ${ok} écrites · ${saute} déjà là · ${echec} en échec\n`);
	if (echecs.length > 0) {
		await Bun.write(join(RACINE, "echecs.txt"), `${echecs.join("\n")}\n`);
		console.log(`[dump] détail des échecs → ${join(RACINE, "echecs.txt")}`);
	}
}

// ── État ────────────────────────────────────────────────────────────────────

async function etat(): Promise<void> {
	const manifeste = await lireManifeste();
	const planches = manifeste.fils.reduce((s, f) => s + f.planches.length, 0);
	const octets = manifeste.fils.reduce(
		(s, f) => s + f.planches.reduce((t, p) => t + p.taille, 0),
		0
	);
	console.log(`Forum « ${manifeste.forumNom} » — indexé le ${manifeste.genereLe}`);
	console.log(`  ${manifeste.fils.length} fils, ${planches} planches, ${poids(octets)}`);

	let surDisque = 0;
	let manquantes = 0;
	for (const fil of manifeste.fils) {
		const presents = new Set(await readdir(join(RACINE, fil.dossier)).catch(() => []));
		for (const planche of fil.planches) {
			if (presents.has(planche.fichier)) surDisque++;
			else manquantes++;
		}
	}
	console.log(`  sur disque : ${surDisque} · manquantes : ${manquantes}`);

	const vides = manifeste.fils.filter((f) => f.planches.length === 0);
	if (vides.length > 0)
		console.log(
			`  fils sans image (${vides.length}) : ${vides
				.slice(0, 5)
				.map((f) => f.nom)
				.join(" · ")}…`
		);
}

// ── Entrée ──────────────────────────────────────────────────────────────────

switch (commande) {
	case "index": {
		const manifeste = await indexer();
		const planches = manifeste.fils.reduce((s, f) => s + f.planches.length, 0);
		const octets = manifeste.fils.reduce(
			(s, f) => s + f.planches.reduce((t, p) => t + p.taille, 0),
			0
		);
		console.log(
			`[index] ${manifeste.fils.length} fils · ${planches} planches · ${poids(octets)} → ${CHEMIN_MANIFESTE}`
		);
		break;
	}
	case "telecharge":
		await telecharger();
		break;
	case "etat":
		await etat();
		break;
	default:
		console.error(`Commande inconnue « ${commande} » — attendu : index | telecharge | etat`);
		process.exit(1);
}
