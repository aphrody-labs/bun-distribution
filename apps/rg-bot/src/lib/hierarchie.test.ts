/**
 * Tests des règles d'attribution de rôle.
 *
 * C'est une surface de SÉCURITÉ : chaque refus y est couvert individuellement,
 * et l'ordre des refus est vérifié — un rôle à la fois trop haut ET dangereux
 * doit être refusé pour la raison la plus utile à qui lit le message.
 *
 * Les positions utilisées reprennent la hiérarchie réelle du serveur, relevée
 * le 14/8/2026 : le bot « RG » est en position 89 ; « Équipe RG » (85) porte des
 * permissions dangereuses ; « Joueur Deluxe niveau 1 » (81) n'en porte aucune.
 */
import { describe, expect, test } from "bun:test";

import {
	filtrerRecompenses,
	peutAgirSurRole,
	verifierAttributionAutomatique,
	verifierRolePriseEnCharge,
	type FaitsBot,
	type FaitsRoleVise,
} from "./hierarchie";

const BOT: FaitsBot = { peutGererRoles: true, positionMax: 89 };

/** Rôle sans permission, bas dans la hiérarchie — le cas normal. */
function role(surcharge: Partial<FaitsRoleVise> = {}): FaitsRoleVise {
	return {
		estEveryone: false,
		gereParIntegration: false,
		id: "1371177169216077864",
		nom: "Joueur Deluxe niveau 1",
		permissions: "0",
		position: 81,
		...surcharge,
	};
}

describe("attribution automatique", () => {
	test("un rôle ordinaire, sous le bot, sans permission : accepté", () => {
		expect(verifierAttributionAutomatique(role(), BOT).ok).toBe(true);
	});

	test("sans « Gérer les rôles », rien n'est attribuable", () => {
		const verdict = verifierAttributionAutomatique(role(), {
			peutGererRoles: false,
			positionMax: 89,
		});
		expect(verdict.ok).toBe(false);
		if (verdict.ok) return;
		expect(verdict.motif).toContain("Gérer les rôles");
	});

	test("`@everyone` est refusé", () => {
		expect(verifierAttributionAutomatique(role({ estEveryone: true }), BOT).ok).toBe(false);
	});

	test("un rôle géré par une intégration est refusé, en disant pourquoi", () => {
		const verdict = verifierAttributionAutomatique(role({ gereParIntegration: true }), BOT);
		expect(verdict.ok).toBe(false);
		if (verdict.ok) return;
		expect(verdict.motif).toContain("intégration");
	});

	test("un rôle au niveau du bot est refusé — la hiérarchie n'est pas négociable", () => {
		expect(verifierAttributionAutomatique(role({ position: 89 }), BOT).ok).toBe(false);
		expect(verifierAttributionAutomatique(role({ position: 90 }), BOT).ok).toBe(false);
		expect(verifierAttributionAutomatique(role({ position: 88 }), BOT).ok).toBe(true);
	});

	test("la position hors de portée nomme les DEUX positions", () => {
		const verdict = verifierAttributionAutomatique(role({ position: 93 }), BOT);
		expect(verdict.ok).toBe(false);
		if (verdict.ok) return;
		expect(verdict.motif).toContain("93");
		expect(verdict.motif).toContain("89");
	});

	test("un rôle DANGEREUX est refusé même s'il est bas et attribuable", () => {
		// « Équipe RG » : position 85, sous le bot, non géré — et pourtant refusé.
		// C'est la règle qui empêche « niveau 30 → modération ».
		for (const permissions of [
			"8", // Administrator
			"32", // ManageGuild
			(1n << 28n).toString(), // ManageRoles
			"4", // BanMembers
			"2", // KickMembers
		]) {
			const verdict = verifierAttributionAutomatique(
				role({ nom: "Équipe RG", permissions, position: 85 }),
				BOT
			);
			expect(verdict.ok).toBe(false);
		}
	});

	test("le refus de hiérarchie passe AVANT le refus de permissions", () => {
		// Un rôle à la fois trop haut et dangereux : la première chose à corriger
		// est la position, sans quoi remonter le bot ne changerait rien.
		const verdict = verifierAttributionAutomatique(
			role({ permissions: "8", position: 93 }),
			BOT
		);
		expect(verdict.ok).toBe(false);
		if (verdict.ok) return;
		expect(verdict.motif).toContain("hiérarchie");
	});
});

describe("rôle de prise en charge", () => {
	test("un rôle de modération est un bon rôle de prise en charge", () => {
		const verdict = verifierRolePriseEnCharge(role({ nom: "Modérateurs", permissions: "4" }));
		expect(verdict.ok).toBe(true);
		if (!verdict.ok) return;
		expect(verdict.avertissements).toEqual([]);
	});

	test("un rôle sans aucune permission de modération lève un doute, pas un refus", () => {
		const verdict = verifierRolePriseEnCharge(role());
		expect(verdict.ok).toBe(true);
		if (!verdict.ok) return;
		expect(verdict.avertissements).toHaveLength(1);
	});

	test("`@everyone` est refusé : un ticket ne peut pas être ouvert à tous", () => {
		expect(verifierRolePriseEnCharge(role({ estEveryone: true })).ok).toBe(false);
	});

	test("le rôle d'un bot est refusé : aucun humain ne le porte", () => {
		expect(verifierRolePriseEnCharge(role({ gereParIntegration: true })).ok).toBe(false);
	});
});

describe("hiérarchie du staff", () => {
	test("on ne touche pas un rôle au niveau ou au-dessus du sien", () => {
		expect(peutAgirSurRole(87, 85)).toBe(true);
		expect(peutAgirSurRole(87, 87)).toBe(false);
		expect(peutAgirSurRole(87, 90)).toBe(false);
	});

	test("le propriétaire du serveur échappe à la règle", () => {
		expect(peutAgirSurRole(1, 93, true)).toBe(true);
	});
});

describe("filtrage des récompenses déjà en base", () => {
	const faits = new Map<string, FaitsRoleVise>([
		["bon", role({ id: "bon", position: 81 })],
		["dangereux", role({ id: "dangereux", nom: "Équipe RG", permissions: "8", position: 85 })],
		["trop-haut", role({ id: "trop-haut", position: 93 })],
	]);

	test("seules les lignes sûres sont posées, et les autres sont EXPLIQUÉES", () => {
		const { bloquees, posables } = filtrerRecompenses(
			[
				{ niveau: 10, roleId: "bon" },
				{ niveau: 20, roleId: "dangereux" },
				{ niveau: 30, roleId: "trop-haut" },
				{ niveau: 40, roleId: "disparu" },
			],
			faits,
			BOT
		);
		expect(posables.map((r) => r.roleId)).toEqual(["bon"]);
		expect(bloquees).toHaveLength(3);
		for (const bloquee of bloquees) {
			expect(bloquee.motif.length).toBeGreaterThan(20);
		}
	});

	test("un rôle supprimé du serveur est signalé, pas ignoré", () => {
		const { bloquees } = filtrerRecompenses([{ niveau: 5, roleId: "disparu" }], faits, BOT);
		expect(bloquees[0]?.motif).toContain("n'existe plus");
	});

	test("aucune récompense : aucune ligne bloquée non plus", () => {
		expect(filtrerRecompenses([], faits, BOT)).toEqual({ bloquees: [], posables: [] });
	});
});
