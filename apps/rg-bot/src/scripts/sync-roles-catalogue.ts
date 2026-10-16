/**
 * Remplit `discord_roles_catalogue` : permissions décodées, dangerosité,
 * porteurs et catégorie/utilité pour chaque rôle Discord — ce que
 * `discord_roles` (miroir brut, réécrit par `syncAllRoles`) ne porte pas.
 *
 * ── POURQUOI UN SCRIPT À PART, PAS UNE ÉTAPE DE `syncAllRoles` ─────────────
 * `syncAllRoles` (`packages/cron/src/lib/discord.ts`) tourne à chaque passage
 * du cron et n'a besoin QUE du gateway déjà connecté (`guild.roles.fetch()`
 * sur le cache). Ce script, lui, appelle l'API REST directement — sans ouvrir
 * de connexion gateway ni charger ~1 984 membres — parce que la
 * classification (`classifierRole`, `apps/bot/src/lib/
 * discord-roles-catalogue.ts`) est un travail d'ANALYSE qui ne doit PAS se
 * rejouer à chaque cycle du cron : une catégorie choisie à la main ne doit
 * pas disparaître au prochain balayage. On le lance à la main, après avoir
 * relu/étendu la classification pour de nouveaux rôles.
 *
 * ── DEUX GUILDES, DEUX JETONS CANDIDATS ─────────────────────────────────────
 * Le bot Rose Griffon (`DISCORD_BOT_TOKEN`) ET le bot Azalée
 * (`AZALEE_DISCORD_BOT_TOKEN`) sont chacun candidats pour chaque guilde
 * enregistrée dans `@rosegriffon/types/discord` — on essaie les deux et on
 * garde le premier qui répond. Vérifié le 14/8/2026 : la guilde Azalée
 * (`AZALEE_GUILD_ID`) répond `10004 Unknown Guild` aux
 * DEUX jetons — ni l'un ni l'autre bot ne l'a rejointe, malgré le nom du
 * profil (confirmé aussi dans `apps/bot/src/lib/profil.ts`, commentaire du
 * profil `azalee`). Cette guilde est donc IGNORÉE avec un message clair,
 * jamais remplie de données inventées. Le script reste prêt à la couvrir dès
 * qu'un des deux bots la rejoindra, sans modification.
 *
 * ── LES PORTEURS NE SONT COMPTABLES QUE POUR LA GUILDE MIROIR ──────────────
 * `discord_members` ne suit QUE la guilde Rose Griffon (aucune colonne
 * `guild_id` : c'est un choix assumé, cf. commentaire de service systemd
 * `azalee-bot.service`, "Ce bot ne synchronise RIEN"). `porteurs_count` n'est
 * donc exact que pour les rôles de cette guilde ; pour toute autre guilde
 * couverte un jour, il reste à 0 et le sait dire.
 *
 * Lancer : `bun src/scripts/sync-roles-catalogue.ts` (depuis `apps/bot`).
 */
import { RG_GUILD_ID, AZALEE_GUILD_ID } from "@rosegriffon/types/discord";

import {
	classifierRole,
	decoderPermissions,
	estDangereux,
	type FaitsRole,
} from "../lib/discord-roles-catalogue";
import { sql } from "../lib/db";
import { litteralTexteArray } from "../services/tweets";

/** Un rôle tel que rendu par `GET /guilds/{id}/roles`. */
interface RoleAPI {
	readonly id: string;
	readonly name: string;
	readonly position: number;
	readonly permissions: string;
	readonly managed: boolean;
	readonly tags?: {
		readonly bot_id?: string;
		readonly premium_subscriber?: null;
		readonly subscription_listing_id?: string;
	};
}

const GUILDES = [
	{ guildId: RG_GUILD_ID, label: "Rose Griffon" },
	{ guildId: AZALEE_GUILD_ID, label: "Azalée" },
] as const;

const VARIABLES_JETON = ["DISCORD_BOT_TOKEN", "AZALEE_DISCORD_BOT_TOKEN"] as const;

/** Récupère les rôles d'UNE guilde, en essayant chaque jeton candidat. */
async function recupererRoles(
	guildId: string
): Promise<{ roles: RoleAPI[] } | { erreur: string }> {
	const jetons = VARIABLES_JETON.map((nom) => ({ nom, valeur: Bun.env[nom] })).filter(
		(j): j is { nom: (typeof VARIABLES_JETON)[number]; valeur: string } => Boolean(j.valeur)
	);
	if (jetons.length === 0) {
		return { erreur: "aucun jeton de bot disponible dans l'environnement" };
	}

	const echecs: string[] = [];
	for (const jeton of jetons) {
		const reponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
			headers: { Authorization: `Bot ${jeton.valeur}` },
		});
		if (reponse.ok) {
			return { roles: (await reponse.json()) as RoleAPI[] };
		}
		const corps = await reponse.text();
		echecs.push(`${jeton.nom} → ${reponse.status} ${corps}`);
	}
	return { erreur: echecs.join(" ; ") };
}

/** Membres actifs porteurs de chaque rôle — uniquement exact pour Rose Griffon. */
async function compterPorteurs(guildId: string): Promise<Map<string, number>> {
	const compte = new Map<string, number>();
	if (guildId !== RG_GUILD_ID) {
		// `discord_members` ne décrit que la guilde Rose Griffon (cf. en-tête) :
		// pour toute autre guilde, on ne prétend pas savoir.
		return compte;
	}
	const lignes = await sql<Array<{ role_id: string; porteurs: number }>>`
		SELECT r.role_id, count(m.discord_id)::int AS porteurs
		FROM public.discord_roles r
		LEFT JOIN public.discord_members m
			ON m.left_at IS NULL AND r.role_id = ANY(m.roles)
		WHERE r.guild_id = ${guildId}
		GROUP BY r.role_id
	`;
	for (const ligne of lignes) {
		compte.set(ligne.role_id, ligne.porteurs);
	}
	return compte;
}

function faitsDepuisRole(role: RoleAPI, porteurs: number): FaitsRole {
	return {
		roleId: role.id,
		nom: role.name,
		position: role.position,
		permissions: role.permissions,
		gereParIntegration: role.managed,
		tagBotId: role.tags?.bot_id ?? null,
		tagAbonnement: Boolean(
			role.tags && ("premium_subscriber" in role.tags || role.tags.subscription_listing_id)
		),
		porteurs,
	};
}

/** Écrit une ligne du catalogue. Rend vrai si le rôle avait une catégorie connue. */
async function upsertRole(guildId: string, role: RoleAPI, porteurs: number): Promise<boolean> {
	const faits = faitsDepuisRole(role, porteurs);
	// Bun.SQL sérialise un tableau JS en `a,b`, que Postgres rejette
	// (« malformed array literal ») : littéral `{"a","b"}`, param lié — jamais
	// de SQL concaténé (même piège que `synchroniser.ts`).
	const permissionsLiteral = litteralTexteArray(decoderPermissions(role.permissions));
	const dangereux = estDangereux(role.permissions);
	const { categorie, utilite } = classifierRole(faits);
	const typeIntegration = role.managed ? (faits.tagBotId ? "bot" : "abonnement") : null;

	await sql`
		INSERT INTO public.discord_roles_catalogue (
			role_id, guild_id, permissions_decodees, permissions_dangereuses,
			porteurs_count, categorie, utilite, gere_par_integration, type_integration, maj_le
		) VALUES (
			${role.id}, ${guildId}, ${permissionsLiteral}::text[], ${dangereux},
			${porteurs}, ${categorie}, ${utilite}, ${role.managed}, ${typeIntegration}, NOW()
		)
		ON CONFLICT (role_id) DO UPDATE SET
			guild_id = EXCLUDED.guild_id,
			permissions_decodees = EXCLUDED.permissions_decodees,
			permissions_dangereuses = EXCLUDED.permissions_dangereuses,
			porteurs_count = EXCLUDED.porteurs_count,
			categorie = EXCLUDED.categorie,
			utilite = EXCLUDED.utilite,
			gere_par_integration = EXCLUDED.gere_par_integration,
			type_integration = EXCLUDED.type_integration,
			maj_le = NOW()
	`;
	return categorie !== null;
}

async function synchroniserGuilde(guildId: string, label: string): Promise<void> {
	const resultat = await recupererRoles(guildId);
	if ("erreur" in resultat) {
		console.warn(`⚠ ${label} (${guildId}) ignorée : ${resultat.erreur}`);
		return;
	}

	const porteursParRole = await compterPorteurs(guildId);
	let nonClasses = 0;
	for (const role of resultat.roles) {
		const classe = await upsertRole(guildId, role, porteursParRole.get(role.id) ?? 0);
		if (!classe) nonClasses++;
	}

	const suffixe = nonClasses > 0 ? `, dont ${nonClasses} sans catégorie (à analyser)` : "";
	console.log(`✓ ${label} (${guildId}) : ${resultat.roles.length} rôle(s) catalogué(s)${suffixe}`);
}

for (const { guildId, label } of GUILDES) {
	await synchroniserGuilde(guildId, label);
}

process.exit(0);
