"use server";

/**
 * DÉPÔT D'UNE CRÉATION INSTAGRAM PAR UN MEMBRE.
 *
 * ── POURQUOI UN FORMULAIRE, ET PAS UN COLLECTEUR ───────────────────────────
 * Il n'existe AUCUN moyen automatique de récolter un hashtag Instagram
 * aujourd'hui (mesuré le 13/8/2026 : `?__a=1` rend une enveloppe d'erreur,
 * GraphQL rend 401 `require_login`, `api/v1/tags/web_info` redirige vers la page
 * de connexion). Les bibliothèques exigent toutes une session — les employer
 * avec le compte de l'association l'exposerait à un blocage en pleine campagne.
 * L'API Graph officielle marche mais demande une revue Meta de deux à quatre
 * semaines, et ne rend même pas le pseudo de l'auteur.
 *
 * ⚠ CE QUI EST FAUX DANS LA PHRASE PRÉCÉDENTE, ET QUI L'ÉTAIT DÉJÀ ICI.
 * Ce commentaire affirmait aussi que « le HTML d'un post ne porte plus ni `og:`,
 * ni JSON-LD, ni `window._sharedData` ». Re-mesuré le 22/8/2026 sur deux posts
 * réels : JSON-LD et `_sharedData` ont bien disparu, mais les balises `og:` sont
 * TOUJOURS LÀ — `og:title`, `og:image` (recadrée en 640 carré) et surtout
 * `og:description`, qui écrit la date en clair (« on August 21, 2026 »). Et
 * `https://www.instagram.com/api/v1/oembed/` répond 200 sans jeton avec la
 * légende entière, le pseudo et le `media_id` (cf. l'en-tête de
 * `@rosegriffon/types/instagram`). Le HASHTAG reste introuvable sans session —
 * donc rien ne change pour la RÉCOLTE, et ce formulaire garde sa raison d'être.
 * Mais une publication DONT ON A DÉJÀ LE LIEN se lit très bien : c'est ce qui a
 * permis à l'équipe de saisir les deux participations Instagram d'IERG Day.
 * « On ne peut pas récolter » ne veut pas dire « on ne peut rien lire », et
 * confondre les deux a failli coûter deux créations au tirage.
 *
 * Le participant dépose donc lui-même son permalien et son image. C'est plus
 * fiable sur un point que tout collecteur : **l'attribution est exacte**, parce
 * que c'est l'auteur qui se nomme.
 *
 * ── CE QUI PROTÈGE LA GALERIE ──────────────────────────────────────────────
 *  1. SESSION OBLIGATOIRE. Un dépôt anonyme est un formulaire de spam ouvert sur
 *     une galerie publique. `soumis_par` garde qui a déposé quoi.
 *  2. LIEN VÉRIFIÉ chez Meta (oEmbed public, sans jeton) : une publication
 *     inexistante, supprimée ou privée est refusée avant d'entrer en base.
 *  3. IMAGE RÉ-HÉBERGÉE dans notre Storage. Les URL `cdninstagram.com` sont
 *     signées et expirent : servir le lien d'origine donnerait une galerie de
 *     vignettes mortes le lendemain.
 *  4. QUOTA PAR MEMBRE. Une campagne communautaire n'a pas besoin de trente
 *     dépôts du même compte, et un formulaire sans plafond finit toujours par
 *     servir à autre chose.
 *  5. RELAIS VERS LE STAFF. Chaque dépôt part dans le salon de suivi à la passe
 *     suivante (`campagnes:relais`) : rien n'entre sans qu'un humain le voie.
 */

import {
	analyserPermalien,
	hashtagDansLegende,
	normaliserPseudo,
	verifierPublication,
} from "@rosegriffon/types/instagram";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getServerUser } from "@/lib/auth-helpers";
import { getPgPool } from "@/lib/db/pg";
import { createPostgresClient } from "@rosegriffon/db/service";

/** Retour uniforme du formulaire. */
export interface ResultatDepot {
	success: boolean;
	error?: string;
	message?: string;
}

/** Bucket public des visuels de campagne — le même que pour Discord. */
const BUCKET = "assets";

/** Dépôts acceptés par membre et par campagne. */
const MAX_DEPOTS_PAR_MEMBRE = 10;

/** Formats acceptés et poids maximal — alignés sur l'envoi d'image du staff. */
const TYPES_ACCEPTES = new Set(["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"]);
const EXTENSIONS: Record<string, string> = {
	"image/avif": "avif",
	"image/gif": "gif",
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
};
const TAILLE_MAX = 8 * 1024 * 1024;

const schema = z.object({
	campagne: z.string().trim().min(1),
	permalien: z.string().trim().min(1, "Colle le lien de ta publication Instagram."),
	pseudo: z.string().trim().max(60).optional(),
	legende: z.string().trim().max(2200).optional(),
});

/**
 * Enregistre une création Instagram déposée par un membre.
 *
 * Reçoit un `FormData` : c'est la seule forme qui transporte un fichier jusqu'à
 * une server action sans passer par une route API et un second aller-retour.
 */
export async function deposerCreationInstagram(donnees: FormData): Promise<ResultatDepot> {
	const membre = await getServerUser();
	if (!membre) {
		return {
			error: "Connecte-toi pour déposer ta création — c'est ce qui nous permet de te l'attribuer.",
			success: false,
		};
	}

	const analyse = schema.safeParse({
		campagne: donnees.get("campagne"),
		legende: donnees.get("legende") ?? undefined,
		permalien: donnees.get("permalien"),
		pseudo: donnees.get("pseudo") ?? undefined,
	});
	if (!analyse.success) {
		return { error: analyse.error.issues[0]?.message ?? "Formulaire incomplet.", success: false };
	}
	const v = analyse.data;

	const lien = analyserPermalien(v.permalien);
	if (!lien) {
		return {
			error:
				"Ce lien n'est pas une publication Instagram. Attendu : instagram.com/p/… (ou /reel/…).",
			success: false,
		};
	}

	const fichier = donnees.get("image");
	if (!(fichier instanceof File) || fichier.size === 0) {
		return {
			error: "Ajoute l'image de ta création : Instagram ne nous laisse pas la récupérer nous-mêmes.",
			success: false,
		};
	}
	if (!TYPES_ACCEPTES.has(fichier.type)) {
		return { error: "Format non supporté : PNG, JPEG, WebP, AVIF ou GIF.", success: false };
	}
	if (fichier.size > TAILLE_MAX) {
		return { error: "L'image ne doit pas dépasser 8 Mo.", success: false };
	}

	try {
		const pool = getPgPool();

		// La campagne doit être ouverte au dépôt. On relit son état plutôt que de
		// faire confiance au champ caché du formulaire : celui-ci vient du
		// navigateur, donc de personne.
		const { rows: campagnes } = await pool.query(
			`select slug, hashtags, hashtags_rattrapage, fin_le, actif, publiee
			   from public.x_campagnes where slug = $1`,
			[v.campagne]
		);
		const campagne = campagnes[0];
		if (!campagne || !campagne.actif || !campagne.publiee) {
			return { error: "Cette campagne n'accepte pas de dépôt.", success: false };
		}
		if (campagne.fin_le && new Date(campagne.fin_le) < new Date()) {
			return { error: "Cette campagne est close : les dépôts sont terminés.", success: false };
		}

		// Quota par membre. Compté AVANT la vérification Meta et l'envoi du
		// fichier : inutile de faire travailler deux services pour refuser ensuite.
		const { rows: deja } = await pool.query(
			`select count(*)::int as n from public.campagne_creations_instagram
			  where campagne_slug = $1 and soumis_par = $2`,
			[campagne.slug, membre.id]
		);
		if ((deja[0]?.n ?? 0) >= MAX_DEPOTS_PAR_MEMBRE) {
			return {
				error: `Tu as déjà déposé ${MAX_DEPOTS_PAR_MEMBRE} créations pour cette campagne. Écris à l'équipe si tu en as d'autres.`,
				success: false,
			};
		}

		// Le lien existe-t-il et est-il public ? Une panne de Meta ne bloque PAS le
		// dépôt (`indeterminee`) : le staff verra la création arriver dans son salon
		// de suivi et tranchera. Faire payer au participant une panne qui n'est pas
		// la sienne serait le pire des deux mondes.
		// Les règles (analyse du lien, verdict) vivent dans
		// `@rosegriffon/types/instagram` : le cron `campagnes:instagram` REVALIDE
		// plus tard exactement les mêmes liens, et deux lectures divergentes
		// laisseraient un post supprimé affiché — ou masqueraient la galerie sur
		// une panne de Meta.
		const verification = await verifierPublication(lien.permalien, {
			base: process.env.INSTAGRAM_OEMBED_URL,
		});
		if (verification.verdict === "introuvable") {
			return { error: verification.message, success: false };
		}

		// Ré-hébergement. Chemin DÉTERMINISTE : un second dépôt du même post écrase
		// le même objet au lieu d'en empiler une copie par tentative.
		const extension = EXTENSIONS[fichier.type] ?? "bin";
		const chemin = `campagnes/${campagne.slug}/instagram/${lien.shortcode}.${extension}`;
		const admin = createPostgresClient();
		if (!admin) {
			return { error: "Service de stockage indisponible. Réessaie dans un moment.", success: false };
		}
		const { error: erreurEnvoi } = await admin.storage.from(BUCKET).upload(chemin, fichier, {
			cacheControl: "3600",
			contentType: fichier.type,
			upsert: true,
		});
		if (erreurEnvoi) {
			console.error("[iergday] envoi de l'image Instagram :", erreurEnvoi);
			return { error: "L'image n'a pas pu être enregistrée. Réessaie.", success: false };
		}

		const hashtags = [
			...((campagne.hashtags as string[]) ?? []),
			...((campagne.hashtags_rattrapage as string[]) ?? []),
		];

		// ⚠ `masque`, `motif_masquage` et `mis_en_avant` sont ABSENTS de la clause
		// `do update` — même règle que les deux autres sources. Sans ça, un membre
		// dont la création vient d'être retirée la ferait réapparaître en la
		// redéposant.
		await pool.query(
			`insert into public.campagne_creations_instagram
			   (campagne_slug, shortcode, permalink, auteur_pseudo, legende, hashtag_trouve,
			    a_media, nb_images, images, publie_le, origine, soumis_par)
			 values ($1, $2, $3, $4, $5, $6, true, 1, $7::jsonb, now(), 'formulaire', $8)
			 on conflict (campagne_slug, shortcode) do update set
			   permalink     = excluded.permalink,
			   auteur_pseudo = coalesce(excluded.auteur_pseudo, public.campagne_creations_instagram.auteur_pseudo),
			   legende       = excluded.legende,
			   hashtag_trouve = excluded.hashtag_trouve,
			   a_media       = true,
			   nb_images     = excluded.nb_images,
			   images        = excluded.images,
			   collecte_le   = now()`,
			[
				campagne.slug,
				lien.shortcode,
				lien.permalien,
				normaliserPseudo(v.pseudo) ?? lien.pseudo,
				v.legende ?? null,
				hashtagDansLegende(v.legende ?? "", hashtags),
				JSON.stringify([
					{
						chemin,
						hauteur: null,
						largeur: null,
						nom: fichier.name,
						taille: fichier.size,
						type_mime: fichier.type,
						url_origine: lien.permalien,
					},
				]),
				membre.id,
			]
		);

		revalidatePath("/iergday");
		revalidatePath("/admin/iergday");

		return {
			message:
				verification.verdict === "publique"
					? "Merci ! Ta création rejoint la galerie."
					: verification.message,
			success: true,
		};
	} catch (err) {
		console.error("[iergday] dépôt Instagram :", err);
		return { error: "Le dépôt a échoué. Réessaie dans un moment.", success: false };
	}
}
