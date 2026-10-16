import "server-only";

import { RG_GUILD_ID } from "@rosegriffon/types/discord";

import { getPgPool } from "@/lib/db/pg";
import { SITE_URL } from "@/lib/site-url";

import { API_DISCORD, type GagnantAnnonce, imageAbsolue, origine } from "./annonce-discord-charge";
import type { SourceTirage } from "./tirage";
import { urlMessageDiscord, urlPostX } from "./types";

/*
 * L'ENVOI DE L'ANNONCE DANS LE SALON PUBLIC DE LA CAMPAGNE.
 *
 * La CHARGE du message vit dans `annonce-discord-charge.ts`, pure et testée
 * seule ; ce fichier-ci ne fait que trois choses qui touchent le monde
 * extérieur : lire la base pour compléter les gagnants, vérifier que le salon
 * visé est bien le salon public, et poster. Il porte donc `import "server-only"`.
 *
 * ⚠ IL NE DÉCIDE JAMAIS D'ANNONCER. La décision est un geste d'admin explicite,
 * confirmé au clavier, pris dans `app/admin/iergday/actions-tirage.ts` — jamais
 * un cron, jamais un trigger, jamais un effet de bord du tirage ou de la
 * publication. Règle absolue du projet : aucune publication publique automatique.
 */

/*
 * Ré-exports de commodité : l'appelant (une server action, donc déjà côté
 * serveur) n'a qu'une porte à pousser. Le test, lui, vise le module pur
 * directement — c'est tout l'intérêt de la coupure.
 */
export {
	API_DISCORD,
	chargeAnnonceTirage,
	type ContexteAnnonce,
	type GagnantAnnonce,
	imageAbsolue,
	neutraliserMentions,
	ordinalFr,
	origine,
	SALON_TEST_DEFAUT,
} from "./annonce-discord-charge";

function dormir(ms: number): Promise<void> {
	return new Promise((resoudre) => setTimeout(resoudre, ms));
}

/**
 * Poste l'annonce. LÈVE sur échec — jamais de succès silencieux.
 *
 * Un `console.warn` suivi d'un `null`, comme le fait le publieur d'alertes du
 * cron, serait ici la pire des réponses : l'écran d'admin marquerait le tirage
 * annoncé et personne ne s'apercevrait que le salon n'a rien reçu. L'appelant
 * DOIT savoir que rien n'est parti, pour pouvoir recommencer.
 *
 * 429 : Discord donne le délai exact. Le respecter UNE fois vaut mieux que
 * réessayer à l'aveugle et se faire fermer la route — et une seule réémission
 * suffit, l'admin étant le seul écrivain de ce salon.
 */
export async function posterAnnonce(
	salonId: string,
	charge: Record<string, unknown>
): Promise<{ id: string }> {
	const jeton = process.env.DISCORD_BOT_TOKEN;
	if (!jeton) {
		throw new Error(
			"DISCORD_BOT_TOKEN absent de l'environnement du site : aucune annonce ne peut partir. " +
				"La variable est chargée par `EnvironmentFile=` de `website-web.service` depuis `apps/website/.env`."
		);
	}

	const envoyer = async (): Promise<Response> =>
		fetch(`${API_DISCORD}/channels/${encodeURIComponent(salonId)}/messages`, {
			body: JSON.stringify(charge),
			headers: {
				Authorization: `Bot ${jeton}`,
				"Content-Type": "application/json",
				"User-Agent": `RoseGriffonSite (${SITE_URL}, 1.0)`,
			},
			method: "POST",
			signal: AbortSignal.timeout(8000),
		});

	let reponse = await envoyer();
	if (reponse.status === 429) {
		const corps = (await reponse.json().catch(() => ({}))) as { retry_after?: number };
		// `retry_after` est en secondes décimales ; la marge de 250 ms évite d'être
		// refusé une seconde fois pour quelques millisecondes d'avance.
		await dormir(Math.min(8000, Math.ceil((corps.retry_after ?? 1) * 1000) + 250));
		reponse = await envoyer();
	}

	if (!reponse.ok) {
		const texte = await reponse.text().catch(() => "");
		throw new Error(`Discord a refusé l'annonce (${reponse.status}) : ${texte.slice(0, 300)}`);
	}
	const cree = (await reponse.json()) as { id?: string };
	if (!cree.id) {
		throw new Error("Discord a accepté l'annonce sans rendre d'identifiant de message : état incertain.");
	}
	return { id: cree.id };
}

/* ── LE SALON ─────────────────────────────────────────────────────────────── */

export interface SalonAnnonce {
	id: string;
	nom: string | null;
	guildId: string | null;
	/** `true` pour le salon de test : il n'est pas sous veille, et c'est normal. */
	estTest: boolean;
}

/**
 * Vérifie qu'un salon est bien un salon PUBLIC de dépôt de la campagne.
 *
 * ⚠ LE PIÈGE QUE CETTE FONCTION EXISTE POUR ÉVITER, VÉRIFIÉ EN BASE LE
 * 23/8/2026 : `x_campagnes` d'`iergday` porte DEUX identifiants de salon.
 * `salons_depot = {1537458038623965194}` est `🍰〡iergday` (`type = 0`,
 * `suivi = true`, guilde `1072991720268111892`), le salon public où la
 * communauté a déposé ses créations. `relais_salon = 1537470522764304435` est
 * `⚙🍰〡iergday-staff`, le fil de suivi de l'équipe : y annoncer le gagnant
 * serait invisible pour tout le monde sauf nous. On lit donc `salons_depot`, et
 * un identifiant fourni par l'écran n'est accepté que s'il y figure — ou s'il
 * est le salon de test.
 *
 * `type = 0` est un salon textuel de guilde : un fil (`11`) ou un salon vocal
 * ne conviendrait pas. `suivi` garantit en prime que c'est bien un salon que ce
 * dépôt connaît, pas un identifiant tapé au hasard.
 */
export async function verifierSalonAnnonce(
	salonId: string,
	salonsDepot: readonly string[],
	salonTest: string
): Promise<SalonAnnonce> {
	if (!/^\d{15,25}$/.test(salonId)) {
		throw new Error(`« ${salonId} » n'est pas un identifiant de salon Discord.`);
	}
	if (salonId === salonTest) {
		// Le salon de test n'est PAS sous veille (il n'est pas dans
		// `discord_channels`), donc aucune vérification de base n'est possible :
		// c'est la liste blanche explicite qui l'autorise, et rien d'autre.
		return { estTest: true, guildId: null, id: salonId, nom: "salon de test" };
	}
	if (!salonsDepot.includes(salonId)) {
		throw new Error(
			`Le salon ${salonId} n'est pas un salon de dépôt de cette campagne. ` +
				"Les salons autorisés viennent de `x_campagnes.salons_depot`, jamais d'une valeur en dur : " +
				"le salon de suivi de l'équipe (`relais_salon`) ne doit surtout pas recevoir l'annonce publique."
		);
	}

	const { rows } = await getPgPool().query<{
		channel_id: string;
		name: string | null;
		type: number | null;
		suivi: boolean | null;
		guild_id: string | null;
	}>(
		`select channel_id, name, type, suivi, guild_id
		   from public.discord_channels where channel_id = $1`,
		[salonId]
	);
	const salon = rows[0];
	if (!salon) {
		throw new Error(`Le salon ${salonId} est déclaré en dépôt mais inconnu de \`discord_channels\` : rien n'a été envoyé.`);
	}
	if (salon.type !== 0 || !salon.suivi || !salon.guild_id) {
		throw new Error(
			`Le salon « ${salon.name ?? salonId} » n'est pas un salon textuel public sous veille ` +
				`(type = ${String(salon.type)}, suivi = ${String(salon.suivi)}) : annonce refusée.`
		);
	}
	return { estTest: false, guildId: salon.guild_id, id: salon.channel_id, nom: salon.name };
}

/* ── RASSEMBLEMENT DES GAGNANTS ───────────────────────────────────────────── */

/** Ce qu'un gagnant apporte depuis le tirage, avant enrichissement. */
export interface GagnantATrouver {
	rang: number;
	cle: string;
	pseudoAffichage: string;
	creation: { source: SourceTirage; identifiant: string };
	oeuvreId: string | null;
	lot: string | null;
}

/**
 * Complète les gagnants avec leur lien public, leur image et leur flocon Discord.
 *
 * ⚠ LES CLAUSES DE VISIBILITÉ SONT RECOPIÉES À LA MAIN, comme partout dans ce
 * dossier : `getPgPool()` se connecte en rôle `rg`, PROPRIÉTAIRE des tables,
 * donc la RLS ne s'applique pas. Sans `not masque` ni `m.deleted_at is null`,
 * l'annonce pourrait lier une création qu'un modérateur a retirée — publiquement,
 * en la nommant.
 *
 * ⚠ LE FLOCON VIENT DE `x_campagne_participants.identifiants`, TABLE FERMÉE, et
 * on n'en extrait QUE `discord_id`. Ce champ porte le graphe d'identités
 * inter-plateformes que personne n'a publié ; il sert ici à mentionner la bonne
 * personne, jamais à sortir du serveur autrement que sous la forme d'un `<@id>`
 * que le gagnant a lui-même choisi de rendre public en écrivant dans le salon.
 */
export async function rassemblerGagnantsAnnonce(
	slug: string,
	gagnants: readonly GagnantATrouver[]
): Promise<GagnantAnnonce[]> {
	if (gagnants.length === 0) {
		return [];
	}
	const pool = getPgPool();
	const idsX = gagnants.filter((g) => g.creation.source === "x").map((g) => g.creation.identifiant);
	const idsDiscord = gagnants.filter((g) => g.creation.source === "discord").map((g) => g.creation.identifiant);
	const idsInstagram = gagnants
		.filter((g) => g.creation.source === "instagram")
		.map((g) => g.creation.identifiant);
	const oeuvreIds = gagnants.map((g) => g.oeuvreId).filter((id): id is string => Boolean(id));
	const cles = gagnants.map((g) => g.cle);

	const [postsX, postsDiscord, postsInstagram, oeuvres, participants] = await Promise.all([
		idsX.length === 0
			? Promise.resolve({ rows: [] as Array<{ tweet_id: string; author_username: string | null }> })
			: pool.query<{ tweet_id: string; author_username: string | null }>(
					`select p.tweet_id, t.author_username
					   from public.x_campagne_posts p
					   join public.tweets t on t.id = p.tweet_id
					  where p.campagne_slug = $1 and p.tweet_id = any($2::text[]) and not p.masque`,
					[slug, idsX]
				),
		idsDiscord.length === 0
			? Promise.resolve({ rows: [] as Array<{ message_id: string; channel_id: string; guild_id: string | null }> })
			: pool.query<{ message_id: string; channel_id: string; guild_id: string | null }>(
					`select d.message_id, m.channel_id, m.guild_id
					   from public.campagne_creations_discord d
					   join public.discord_messages m on m.message_id = d.message_id
					   join public.discord_channels s on s.channel_id = m.channel_id
					  where d.campagne_slug = $1 and d.message_id = any($2::text[])
					    and not d.masque and m.deleted_at is null and s.suivi`,
					[slug, idsDiscord]
				),
		idsInstagram.length === 0
			? Promise.resolve({ rows: [] as Array<{ shortcode: string; permalink: string | null }> })
			: pool.query<{ shortcode: string; permalink: string | null }>(
					`select i.shortcode, i.permalink
					   from public.campagne_creations_instagram i
					  where i.campagne_slug = $1 and i.shortcode = any($2::text[]) and not i.masque`,
					[slug, idsInstagram]
				),
		oeuvreIds.length === 0
			? Promise.resolve({
					rows: [] as Array<{ oeuvre_id: string; image_master_url: string | null; image_master_chemin: string | null }>,
				})
			: pool.query<{ oeuvre_id: string; image_master_url: string | null; image_master_chemin: string | null }>(
					`select o.oeuvre_id, o.image_master_url, o.image_master_chemin
					   from public.x_campagne_oeuvres o
					  where o.campagne_slug = $1 and o.oeuvre_id = any($2::text[])`,
					[slug, oeuvreIds]
				),
		pool.query<{ cle: string; identifiants: unknown }>(
			`select p.cle, p.identifiants
			   from public.x_campagne_participants p
			  where p.campagne_slug = $1 and p.cle = any($2::text[])`,
			[slug, cles]
		),
	]);

	const pseudoX = new Map(postsX.rows.map((l) => [l.tweet_id, l.author_username]));
	const salonDiscord = new Map(postsDiscord.rows.map((l) => [l.message_id, l]));
	const permalienInstagram = new Map(postsInstagram.rows.map((l) => [l.shortcode, l.permalink]));
	const masterParOeuvre = new Map(postsMaster(oeuvres.rows));
	const floconParCle = new Map(participants.rows.map((l) => [l.cle, floconDiscord(l.cle, l.identifiants)]));

	return gagnants
		.map((gagnant) => ({
			discordId: floconParCle.get(gagnant.cle) ?? floconDiscord(gagnant.cle, null),
			image: gagnant.oeuvreId ? (masterParOeuvre.get(gagnant.oeuvreId) ?? null) : null,
			lien: lienCreation(gagnant, pseudoX, salonDiscord, permalienInstagram),
			lot: gagnant.lot,
			pseudo: gagnant.pseudoAffichage,
			rang: gagnant.rang,
			source: gagnant.creation.source,
		}))
		.toSorted((a, b) => a.rang - b.rang);
}

function postsMaster(
	lignes: ReadonlyArray<{ oeuvre_id: string; image_master_url: string | null; image_master_chemin: string | null }>
): Array<[string, string | null]> {
	return lignes.map((ligne) => [ligne.oeuvre_id, imageAbsolue(ligne.image_master_url, ligne.image_master_chemin)]);
}

/**
 * Le flocon Discord d'un participant, ou `null`.
 *
 * Deux sources, dans cet ordre : la clé elle-même quand elle est déjà une clé
 * Discord (`discord:<flocon>`), puis `identifiants.discord_id` — c'est là que la
 * fusion a rangé le compte Discord d'une personne dont la clé canonique est un
 * identifiant X ou un pseudo Instagram. Rien d'autre : on ne devine pas.
 */
function floconDiscord(cle: string, identifiants: unknown): string | null {
	if (cle.startsWith("discord:")) {
		const flocon = cle.slice("discord:".length);
		return /^\d{15,25}$/.test(flocon) ? flocon : null;
	}
	if (identifiants && typeof identifiants === "object" && !Array.isArray(identifiants)) {
		const brut = (identifiants as Record<string, unknown>).discord_id;
		if (typeof brut === "string" && /^\d{15,25}$/.test(brut)) {
			return brut;
		}
	}
	return null;
}

/**
 * Lien public vers la création gagnante.
 *
 * Le repli `x.com/i/status/<id>` n'est pas une approximation : c'est la forme
 * canonique que X redirige lui-même vers le bon compte. Elle évite d'inventer un
 * pseudo quand la jointure n'a rien rendu — ce qui arrive si la création vient
 * d'être masquée entre le tirage et l'annonce, et c'est précisément le moment où
 * il ne faut surtout pas fabriquer une URL plausible.
 */
function lienCreation(
	gagnant: GagnantATrouver,
	pseudoX: ReadonlyMap<string, string | null>,
	salonDiscord: ReadonlyMap<string, { channel_id: string; guild_id: string | null }>,
	permalienInstagram: ReadonlyMap<string, string | null>
): string {
	const { identifiant, source } = gagnant.creation;
	switch (source) {
		case "x": {
			const pseudo = pseudoX.get(identifiant);
			return pseudo ? urlPostX(pseudo, identifiant) : `https://x.com/i/status/${identifiant}`;
		}
		case "discord": {
			const salon = salonDiscord.get(identifiant);
			return salon
				? urlMessageDiscord(salon.guild_id ?? RG_GUILD_ID, salon.channel_id, identifiant)
				: `${origine()}/iergday`;
		}
		case "instagram": {
			const permalien = permalienInstagram.get(identifiant);
			return permalien ?? `https://www.instagram.com/p/${identifiant}/`;
		}
	}
}
