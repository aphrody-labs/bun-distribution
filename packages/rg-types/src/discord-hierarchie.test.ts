import { describe, expect, test } from "bun:test";

import {
	classerMembre,
	couleurRole,
	estRoleAdministration,
	estRoleModeration,
	grouperParSection,
	lirePermissions,
	PERMISSIONS,
	type MembreDiscord,
	type RoleDiscord,
} from "./discord-hierarchie";

function role(partiel: Partial<RoleDiscord> & { role_id: string; position: number }): RoleDiscord {
	return {
		color: 0,
		is_hoisted: false,
		name: partiel.role_id,
		permissions: "0",
		...partiel,
	};
}

function membre(partiel: Partial<MembreDiscord> & { discord_id: string }): MembreDiscord {
	return { roles: [], username: partiel.discord_id, ...partiel };
}

describe("lirePermissions", () => {
	test("ne perd aucun bit au-delà de 2^53", () => {
		// `MODERATE_MEMBERS` vaut 1 << 40 ; un `Number` le garderait encore, mais
		// le bitfield réel d'un administrateur dépasse largement — celui du rôle
		// « Administrateur » de Rose Griffon vaut 28 587 302 322 175.
		const brut = (PERMISSIONS.MODERATE_MEMBERS | PERMISSIONS.BAN_MEMBERS).toString();
		expect(lirePermissions(brut) & PERMISSIONS.MODERATE_MEMBERS).toBe(
			PERMISSIONS.MODERATE_MEMBERS
		);
		expect(lirePermissions("28587302322175") & PERMISSIONS.ADMINISTRATOR).toBe(
			PERMISSIONS.ADMINISTRATOR
		);
	});

	test("une valeur absente ou illisible ne donne aucun droit", () => {
		expect(lirePermissions(null)).toBe(0n);
		expect(lirePermissions(undefined)).toBe(0n);
		expect(lirePermissions("pas un nombre")).toBe(0n);
	});
});

describe("qualification des rôles", () => {
	const administrateur = role({
		permissions: PERMISSIONS.ADMINISTRATOR.toString(),
		position: 90,
		role_id: "admin",
	});
	const moderateur = role({
		permissions: (PERMISSIONS.BAN_MEMBERS | PERMISSIONS.MANAGE_MESSAGES).toString(),
		position: 84,
		role_id: "mod",
	});
	const decoratif = role({ position: 40, role_id: "cosplayer" });

	test("`ADMINISTRATOR` et `MANAGE_GUILD` gouvernent", () => {
		expect(estRoleAdministration(administrateur)).toBe(true);
		expect(
			estRoleAdministration(
				role({ permissions: PERMISSIONS.MANAGE_GUILD.toString(), position: 1, role_id: "g" })
			)
		).toBe(true);
	});

	test("un rôle d'administration n'est pas compté deux fois comme modérateur", () => {
		// `ADMINISTRATOR` implique tout : sans cette exclusion, l'administrateur
		// apparaîtrait dans les deux sections.
		expect(estRoleModeration(administrateur)).toBe(false);
		expect(estRoleModeration(moderateur)).toBe(true);
	});

	test("un rôle sans permission ne classe personne au staff", () => {
		expect(estRoleAdministration(decoratif)).toBe(false);
		expect(estRoleModeration(decoratif)).toBe(false);
	});
});

describe("classerMembre", () => {
	const roles = new Map<string, RoleDiscord>([
		[
			"admin",
			role({
				is_hoisted: true,
				name: "Administrateur",
				permissions: PERMISSIONS.ADMINISTRATOR.toString(),
				position: 90,
				role_id: "admin",
			}),
		],
		[
			"mod",
			role({
				is_hoisted: true,
				name: "Modérateurs",
				permissions: PERMISSIONS.BAN_MEMBERS.toString(),
				position: 84,
				role_id: "mod",
			}),
		],
		[
			"medaille",
			role({ color: 16_280_770, name: "Médaille Azalée", position: 59, role_id: "medaille" }),
		],
		["joueur", role({ is_hoisted: true, name: "Joueur Débutant", position: 46, role_id: "joueur" })],
	]);

	test("le rang vient des permissions, jamais d'une liste d'identifiants", () => {
		expect(classerMembre(membre({ discord_id: "1", roles: ["admin"] }), roles).rang).toBe(
			"administration"
		);
		expect(classerMembre(membre({ discord_id: "2", roles: ["mod"] }), roles).rang).toBe(
			"moderation"
		);
		expect(
			classerMembre(membre({ discord_id: "3", roles: ["medaille", "joueur"] }), roles).rang
		).toBe("communaute");
	});

	test("la section est le rôle DÉTACHÉ le plus haut, la couleur le rôle le plus haut", () => {
		// Cas réel : « Médaille Azalée » (59, colorée, non détachée) au-dessus de
		// « Joueur Débutant » (46, détachée, sans couleur). Discord range le membre
		// sous « Joueur Débutant » mais l'écrit à la couleur de la médaille.
		const classe = classerMembre(membre({ discord_id: "4", roles: ["joueur", "medaille"] }), roles);
		expect(classe.roleDeSection?.role_id).toBe("joueur");
		expect(classe.roleLePlusHaut?.role_id).toBe("medaille");
		expect(classe.position).toBe(59);
	});

	test("un rôle supprimé du serveur est ignoré, pas deviné", () => {
		const classe = classerMembre(membre({ discord_id: "5", roles: ["disparu"] }), roles);
		expect(classe.roleDeSection).toBeNull();
		expect(classe.rang).toBe("communaute");
	});

	test("le nom affiché suit l'ordre de Discord : surnom, nom global, pseudo", () => {
		expect(
			classerMembre(
				membre({ discord_id: "6", display_name: "Global", nickname: "Surnom", username: "pseudo" }),
				roles
			).nomAffiche
		).toBe("Surnom");
		expect(
			classerMembre(
				membre({ discord_id: "7", display_name: "Global", username: "pseudo" }),
				roles
			).nomAffiche
		).toBe("Global");
		expect(classerMembre(membre({ discord_id: "8", username: "pseudo" }), roles).nomAffiche).toBe(
			"pseudo"
		);
	});
});

describe("grouperParSection", () => {
	const roles = new Map<string, RoleDiscord>([
		["haut", role({ is_hoisted: true, name: "Haut", position: 90, role_id: "haut" })],
		["bas", role({ is_hoisted: true, name: "Bas", position: 10, role_id: "bas" })],
		["discret", role({ name: "Discret", position: 50, role_id: "discret" })],
	]);

	test("les sections suivent l'ordre du serveur, le bloc sans rôle détaché en dernier", () => {
		const membres = [
			classerMembre(membre({ discord_id: "a", roles: ["bas"] }), roles),
			classerMembre(membre({ discord_id: "b", roles: ["discret"] }), roles),
			classerMembre(membre({ discord_id: "c", roles: ["haut"] }), roles),
		];
		expect(grouperParSection(membres).map((s) => s.role?.name ?? null)).toEqual([
			"Haut",
			"Bas",
			null,
		]);
	});

	test("aucune section vide", () => {
		expect(grouperParSection([])).toEqual([]);
	});
});

describe("couleurRole", () => {
	test("`0` n'est pas noir mais l'absence de couleur", () => {
		// Rendre `#000000` écrivait en noir sur le fond sombre du thème Azalée.
		expect(couleurRole(role({ color: 0, position: 1, role_id: "x" }))).toBeNull();
		expect(couleurRole(null)).toBeNull();
	});

	test("complète sur six chiffres", () => {
		expect(couleurRole(role({ color: 0x00_ff_00, position: 1, role_id: "x" }))).toBe("#00ff00");
		expect(couleurRole(role({ color: 8, position: 1, role_id: "x" }))).toBe("#000008");
	});
});
