export enum OrganizationCreationErrors {
	DUPLICATED_MANAGERS = "Vous ne pouvez pas créer une Organisation avec une duplication des managers",
	INVALID_NAME = "Le nom est invalide et ne respecte pas le format demandé",
	NAME_TAKEN = "Le nom est déjà pris par une autre Organisation",
	NORMALIZED_NO_MATCH = "Echec de la vérification du nom normalisé",
	INVALID_SOCIALS = "Les URLs des réseaux sociaux sont invalides",
	INVALID_BROADCASTS = "Les URLs des réseaux de diffusion sont invalides",
	INVALID_ORIGIN = "L'origine de votre organisation n'est pas prise en charge.",
}
