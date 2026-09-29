export enum ClanCreationErrors {
	INVALID_NAME = "Le nom est invalide et ne respecte pas le format demandé",
	NAME_TAKEN = "Le nom est déjà pris par un autre Clan",
	INVALID_SHORTNAME = "Le sigle est invalide et ne respecte pas le format demandé",
	SHORTNAME_TAKEN = "Le sigle est déjà pris par un autre Clan",
	DUPLICATE_FOUNDERS = "Vous ne pouvez pas créer un Clan avec une duplication des membres fondateurs",
	FOUNDER_IN_CLAN = "Un fondateur est déjà dans un autre Clan",
	WRONG_FOUNDERS_NUMBER = "Les fondateurs doivent être au nombre de 5: Président + 4 fondateurs",
	CLAN_CREATION_FAIL = "La création de Clan n'a pas pu aboutir",
	INVALID_SOCIALS = "Les URLs des réseaux sociaux sont invalides",
	DISCORD_USER_FETCH_ERROR = "Au moins un fondateur n'est pas présent sur le Discord d'Achillea",
}

export function isClanCreationError(value: any): value is ClanCreationErrors {
	return Object.values(ClanCreationErrors).includes(value);
}
