import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
	manquesParSection,
	REGLAGES_DEFAUT,
	SchemaModificationReglages,
	type ModificationReglages,
} from "@rosegriffon/types/bot";
import { RG_GUILD_ID } from "@rosegriffon/types/discord";

import { requireApiAdmin } from "@/lib/api-auth";
import {
	enregistrerReglagesGuilde,
	lireReglagesGuilde,
	remplacerReglagesGuilde,
} from "@/lib/bot/reglages";
import { logAdminAction } from "@/lib/admin-logger";

export const dynamic = "force-dynamic";

const FLOCON = /^\d{15,25}$/;

/** Guilde visée, `RG_GUILD_ID` par défaut. Refuse tout ce qui n'est pas un flocon. */
function guildeDemandee(requete: NextRequest): string | null {
	const brut = (requete.nextUrl.searchParams.get("guild") ?? "").trim();
	if (brut === "") {
		return RG_GUILD_ID;
	}
	return FLOCON.test(brut) ? brut : null;
}

/** `GET /api/admin/bot/reglages?guild=…` — le document courant et ses manques. */
export async function GET(requete: NextRequest) {
	const garde = await requireApiAdmin();
	if (!garde.ok) {
		return garde.response;
	}
	const guildId = guildeDemandee(requete);
	if (!guildId) {
		return NextResponse.json({ error: "Identifiant de guilde invalide" }, { status: 400 });
	}

	const etat = await lireReglagesGuilde(guildId);
	return NextResponse.json(
		{ ...etat, manques: manquesParSection(etat.reglages), defauts: REGLAGES_DEFAUT },
		{ headers: { "cache-control": "private, no-store" } }
	);
}

/**
 * `PATCH /api/admin/bot/reglages?guild=…` — modification PARTIELLE.
 *
 * ── POURQUOI PARTIELLE ET NON COMPLÈTE ─────────────────────────────────────
 * Un `PUT` du document entier depuis un formulaire est une course perdue
 * d'avance : le staff ouvre la page, un administrateur change le salon de
 * tickets depuis Discord dans la minute, et le formulaire — qui a lu l'ancien
 * document — le réécrit à l'ancienne valeur en cliquant « enregistrer ». Un
 * patch ne porte QUE ce qui a bougé, donc il ne peut pas écraser ce qu'il
 * n'a pas vu.
 *
 * Le schéma refuse les champs inconnus (`.strict()`) et ne remplit AUCUN
 * défaut : absent veut dire absent, et la fusion garde la valeur en place.
 */
export async function PATCH(requete: NextRequest) {
	const garde = await requireApiAdmin();
	if (!garde.ok) {
		return garde.response;
	}
	const guildId = guildeDemandee(requete);
	if (!guildId) {
		return NextResponse.json({ error: "Identifiant de guilde invalide" }, { status: 400 });
	}

	let corps: unknown;
	try {
		corps = await requete.json();
	} catch {
		return NextResponse.json({ error: "Corps JSON illisible" }, { status: 400 });
	}

	const analyse = SchemaModificationReglages.safeParse(corps);
	if (!analyse.success) {
		return NextResponse.json(
			{
				error: "Réglages refusés",
				details: analyse.error.issues.map((probleme) => ({
					champ: probleme.path.join("."),
					message: probleme.message,
				})),
			},
			{ status: 422 }
		);
	}

	if (Object.keys(analyse.data).length === 0) {
		return NextResponse.json({ error: "Aucune modification fournie" }, { status: 400 });
	}

	try {
		const resultat = await enregistrerReglagesGuilde(
			guildId,
			analyse.data as ModificationReglages
		);
		await logAdminAction("bot.reglages.modifier", "bot_reglages_guilde", guildId, {
			sections: Object.keys(analyse.data),
			profilsPrevenus: resultat.profilsPrevenus,
		});
		return NextResponse.json({
			...resultat,
			manques: manquesParSection(resultat.reglages),
		});
	} catch (erreur) {
		return NextResponse.json(
			{ error: erreur instanceof Error ? erreur.message : "Écriture impossible" },
			{ status: 500 }
		);
	}
}

/**
 * `DELETE /api/admin/bot/reglages?guild=…` — rétablit les défauts.
 *
 * Réservé au rôle `admin` : c'est la seule opération qui SUPPRIME des réglages
 * (salons de tickets, rôles de prise en charge, exclusions d'XP) plutôt que
 * d'en modifier un. Un `staff` peut tout régler, il ne peut pas tout effacer.
 */
export async function DELETE(requete: NextRequest) {
	const garde = await requireApiAdmin();
	if (!garde.ok) {
		return garde.response;
	}
	if (garde.data.role !== "admin") {
		return NextResponse.json(
			{ error: "Rétablir les défauts efface tous les réglages : réservé au rôle admin." },
			{ status: 403 }
		);
	}
	const guildId = guildeDemandee(requete);
	if (!guildId) {
		return NextResponse.json({ error: "Identifiant de guilde invalide" }, { status: 400 });
	}

	const resultat = await remplacerReglagesGuilde(guildId, REGLAGES_DEFAUT);
	await logAdminAction("bot.reglages.reinitialiser", "bot_reglages_guilde", guildId, {
		profilsPrevenus: resultat.profilsPrevenus,
	});
	return NextResponse.json({ ...resultat, manques: manquesParSection(resultat.reglages) });
}
