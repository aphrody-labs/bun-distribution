import type { Metadata } from "next";
import { metadonneesAchillea, resume } from "@/app/achillea/metadonnees";
import { getPublicClan } from "@/lib/achillea/unified-clans";
import { createAchilleaClient } from "@/lib/achillea";
import type { ClanMemberDTO } from "@rosegriffon/achillea-types";
import ClanProfileClient from "./clan-profile-client";

/*
 * Page serveur : elle n'existe que pour porter les métadonnées, que
 * `"use client"` interdit. L'interface, inchangée, vit dans
 * `clan-profile-client.tsx`.
 *
 * Le titre est résolu côté serveur parce qu'un titre générique commun aux 42
 * fiches de clan ne vaudrait pas mieux que le titre unique qu'on vient de
 * supprimer : c'est exactement le même défaut, à une échelle plus petite.
 */
export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	const numero = Number(id);
	const chemin = `/achillea/clans/${id}`;

	if (!Number.isSafeInteger(numero) || numero <= 0) {
		return metadonneesAchillea({
			titre: "Clan introuvable",
			description: "Ce clan Achilléa n'existe pas ou a été dissous.",
			chemin: null,
			indexable: false,
		});
	}

	let clan;
	try {
		clan = await getPublicClan(numero);
	} catch {
		return metadonneesAchillea({
			titre: "Fiche de clan",
			description: "Informations publiques d'un clan compétitif Achilléa.",
			chemin,
		});
	}

	return metadonneesAchillea({
		titre: `${clan.name} (${clan.shortName})`,
		description:
			resume(clan.biography) ??
			`Le clan ${clan.name} sur Achilléa : recrutement ${clan.isRecruiting ? "ouvert" : "fermé"}.`,
		chemin,
	});
}

export default async function ClanProfilePage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const clanId = Number(id);
	if (!Number.isSafeInteger(clanId) || clanId <= 0) return <ClanProfileClient id={id} />;
	const [clanResult, membersResult] = await Promise.allSettled([
		getPublicClan(clanId),
		createAchilleaClient().clans.members(clanId),
	]);
	const initialClan = clanResult.status === "fulfilled" ? clanResult.value : null;
	const initialMembers: ClanMemberDTO[] | null = membersResult.status === "fulfilled" && membersResult.value.ok
		? membersResult.value.value
		: null;
	return <ClanProfileClient id={id} initialClan={initialClan} initialMembers={initialMembers} />;
}
