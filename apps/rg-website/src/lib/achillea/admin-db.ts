import "server-only";

/**
 * Lectures d'administration croisant Rose Griffon et Achilléa.
 *
 * POURQUOI DU SQL ET PAS LE CLIENT HTTP
 * `@rosegriffon/achillea-client` reste la voie normale pour tout ce qui est
 * métier : il porte le contrat, il ne lève pas, il vaut aussi côté navigateur.
 * Mais une page d'administration pose des questions que l'API ne sait pas
 * poser — « combien de membres RG ont aussi un compte Achilléa », « quels
 * capitaines de clan ne sont pas dans la base RG ». Y répondre par HTTP
 * imposerait de tirer 3 850 utilisateurs et 1 812 profils pour les recouper en
 * mémoire, à chaque affichage.
 *
 * Depuis la fusion des bases (`scripts/ops/achillea-merge.ts`), le schéma
 * `achillea` EST dans la base `rg`, avec de vraies tables : la jointure se fait
 * dans Postgres, en une requête, sans passer par une connexion distante.
 * Les écritures passent par les services dédiés (API Achilléa et `rg-cron`) ;
 * cette couche website reste explicitement en lecture seule.
 *
 * ACCÈS
 * Ces fonctions lisent des données personnelles : elles ne doivent être
 * appelées qu'après la garde de session des pages `/admin`. Le schéma porte
 * ses 67 politiques RLS, reprises telles quelles de l'ancienne base — c'est
 * elle la barrière, jamais le GRANT.
 */

import { getPgPool } from "@/lib/db/pg";

export interface RecoupementComptes {
	/** Profils Rose Griffon. */
	profilsRg: number;
	/** Utilisateurs Achilléa. */
	joueursAchillea: number;
	/** Comptes présents des deux côtés, appariés par identifiant Discord. */
	communs: number;
	/** Joueurs Achilléa sans profil RG — cible de la passerelle d'inscription. */
	achilleaSeuls: number;
}

export interface VolumesAchillea {
	clans: number;
	tournois: number;
	licencesActives: number;
	sanctionsOuvertes: number;
	matchsClasses: number;
}

/**
 * Indique si le schéma Achilléa est présent dans la base.
 *
 * Sans ce test, chaque page d'administration planterait avec une erreur
 * Postgres brute sur une base de développement où la fusion n'a pas été jouée.
 * On préfère une page qui dit « données absentes » à une trace d'exception.
 */
export async function schemaAchilleaPresent(): Promise<boolean> {
	const pool = getPgPool();
	const { rows } = await pool.query<{ present: boolean }>(
		`SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema = 'achillea' AND table_name = 'clan'
		) AS present`
	);
	return rows[0]?.present ?? false;
}

/**
 * Recoupe les deux annuaires par identifiant Discord.
 *
 * `achillea."user".id` EST l'identifiant Discord (le compte Achilléa naît d'un
 * OAuth Discord), et `profiles.discord_id` le porte côté RG. C'est la seule
 * clé commune : pas d'e-mail partagé, pas d'identifiant interne unifié.
 */
export async function recouperComptes(): Promise<RecoupementComptes> {
	const pool = getPgPool();
	const { rows } = await pool.query<{
		profils_rg: string;
		joueurs_achillea: string;
		communs: string;
	}>(
		`SELECT
			(SELECT count(*) FROM public.profiles)                                  AS profils_rg,
			(SELECT count(*) FROM achillea."user")                                  AS joueurs_achillea,
			(SELECT count(*) FROM public.profiles p
			  JOIN achillea."user" a ON a.id = p.discord_id)                        AS communs`
	);

	const ligne = rows[0];
	const profilsRg = Number(ligne?.profils_rg ?? 0);
	const joueursAchillea = Number(ligne?.joueurs_achillea ?? 0);
	const communs = Number(ligne?.communs ?? 0);

	return { profilsRg, joueursAchillea, communs, achilleaSeuls: joueursAchillea - communs };
}

/** Volumes bruts d'Achilléa, pour la vue d'ensemble de `/admin`. */
export async function volumesAchillea(): Promise<VolumesAchillea> {
	const pool = getPgPool();
	const { rows } = await pool.query<Record<string, string>>(
		`SELECT
			(SELECT count(*) FROM achillea.clan)                                    AS clans,
			(SELECT count(*) FROM achillea.event WHERE internal_state = 'Finished') AS tournois,
			(SELECT count(*) FROM achillea.license WHERE status = 'Active')         AS licences_actives,  -- l'énum distant est capitalisé ('Active'), pas 'active'
			(SELECT count(*) FROM achillea.sanction)                                AS sanctions,
			(SELECT count(*) FROM achillea.lobby_match)                             AS matchs_classes`
	);

	const l = rows[0];
	return {
		clans: Number(l?.["clans"] ?? 0),
		tournois: Number(l?.["tournois"] ?? 0),
		licencesActives: Number(l?.["licences_actives"] ?? 0),
		sanctionsOuvertes: Number(l?.["sanctions"] ?? 0),
		matchsClasses: Number(l?.["matchs_classes"] ?? 0),
	};
}
