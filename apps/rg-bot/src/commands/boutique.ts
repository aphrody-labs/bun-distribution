/**
 * `/boutique` — la boutique Rose Griffon dans Discord.
 *
 *   /boutique catalogue [categorie]  la liste des produits, groupée par famille
 *   /boutique produit  <produit>     la fiche d'un produit, avec autocomplétion
 *
 * Aucune donnée personnelle ne transite ici : le catalogue est public, et le
 * suivi des commandes (`orders`) n'appartient PAS à cette commande — il vit
 * sous `/staff`, en agrégats, sans identité ni adresse de client.
 *
 * La source du catalogue et la raison de ne pas lire `merch_products` (table
 * vide, et sans `slug` pour bâtir le moindre lien) sont documentées en tête de
 * `lib/boutique-format.ts`. Tout le calcul — prix, fourchettes, recherche, mise
 * en forme — y vit et y est testé ; ce fichier ne fait que peindre des embeds.
 */
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
	ApplicationCommandOptionType,
	type AutocompleteInteraction,
	type ChatInputCommandInteraction,
} from "discord.js";

import {
	BASE_BOUTIQUE,
	CATALOGUE,
	CATEGORIES,
	catalogueParCategorie,
	champsCatalogue,
	chercherProduits,
	formaterEuros,
	formaterFourchettePrix,
	libelleStock,
	MAX_CHAMPS_EMBED,
	MAX_TOTAL_EMBED,
	MAX_VALEUR_CHAMP,
	normaliser,
	trouverProduit,
	urlFicheProduit,
	urlImageProduit,
	type ProduitBoutique,
} from "../lib/boutique-format";
import { rgEmbed, truncate } from "../lib/embeds";

/** Limites DURES de Discord : les dépasser fait échouer l'envoi ENTIER du message. */
const MAX_DESCRIPTION = 4096;
/** Une liste d'autocomplétion est refusée AU-DELÀ de 25 propositions. */
const MAX_PROPOSITIONS = 25;
/** Et chaque proposition (libellé comme valeur) est bornée à 100 caractères. */
const MAX_LONGUEUR_PROPOSITION = 100;

/** Saisie courante de l'option en cours d'autocomplétion. */
function saisie(interaction: AutocompleteInteraction): string {
	const valeur = interaction.options.getFocused();
	return typeof valeur === "string" ? valeur : String(valeur ?? "");
}

/**
 * Autocomplétion tolérante : elle ne lève jamais. Une exception laisserait le
 * champ Discord figé sur « chargement… » côté membre.
 */
async function repondreSuggestions(
	interaction: AutocompleteInteraction,
	produire: () => Array<{ name: string; value: string }>
): Promise<void> {
	try {
		await interaction.respond(
			produire()
				.filter((choix) => choix.value.length > 0)
				.slice(0, MAX_PROPOSITIONS)
				.map((choix) => ({
					name: truncate(choix.name, MAX_LONGUEUR_PROPOSITION),
					value: truncate(choix.value, MAX_LONGUEUR_PROPOSITION),
				}))
		);
	} catch {
		// Le repli peut échouer lui aussi — jeton d'autocomplétion expiré, ou
		// réponse déjà envoyée. Le laisser lever produirait un rejet non attrapé
		// dans le gestionnaire d'événement de discordx ; or il n'y a plus rien à
		// sauver côté membre : le champ se contentera de ne rien proposer.
		try {
			await interaction.respond([]);
		} catch (err) {
			console.warn("[boutique] autocomplétion impossible :", err);
		}
	}
}

/** Un produit dans une liste d'autocomplétion : nom + prix, valeur = slug. */
function choixProduit(produit: ProduitBoutique): { name: string; value: string } {
	return {
		name: `${produit.nom} — ${formaterFourchettePrix(produit)}`,
		value: produit.slug,
	};
}

@Discord()
@SlashGroup({
	description: "La boutique Rose Griffon : catalogue et fiches produit",
	name: "boutique",
})
@SlashGroup("boutique")
export class CommandesBoutique {
	@Slash({
		description: "Le catalogue de la boutique, avec les prix et les liens vers les fiches",
		name: "catalogue",
	})
	async catalogue(
		@SlashOption({
			autocomplete: (interaction: AutocompleteInteraction) =>
				repondreSuggestions(interaction, () => {
					const aiguille = normaliser(saisie(interaction));
					return CATEGORIES.filter(
						(famille) => aiguille.length === 0 || normaliser(famille.libelle).includes(aiguille)
					).map((famille) => ({ name: famille.libelle, value: famille.valeur }));
				}),
			description: "Ne montrer qu'une famille de produits (prints, stickers, textile…)",
			name: "categorie",
			required: false,
			type: ApplicationCommandOptionType.String,
		})
		categorie: string | undefined,
		interaction: ChatInputCommandInteraction
	): Promise<void> {
		await interaction.deferReply();

		const groupes = catalogueParCategorie(categorie);
		if (groupes.length === 0) {
			await interaction.editReply({
				content: `Aucun produit dans la famille « ${truncate(categorie ?? "", 80)} ». Familles disponibles : ${CATEGORIES.map((f) => f.libelle).join(", ")}.`,
			});
			return;
		}

		const nombreDeProduits = groupes.reduce((total, groupe) => total + groupe.produits.length, 0);
		const prixMini = formaterEuros(Math.min(...CATALOGUE.map((p) => p.prixCents)));
		const prixMaxi = formaterEuros(Math.max(...CATALOGUE.map((p) => p.prixMaxCents)));
		const titre = "Boutique Rose Griffon";
		const entete = categorie
			? `${nombreDeProduits} produit${nombreDeProduits > 1 ? "s" : ""} dans cette famille. Commande sur ${BASE_BOUTIQUE}/shop.`
			: `${nombreDeProduits} produits, de ${prixMini} à ${prixMaxi}. Commande sur ${BASE_BOUTIQUE}/shop.`;

		// Le budget des champs, c'est les 6 000 caractères de l'embed MOINS ce qui
		// est déjà écrit ailleurs (titre, description, pied de page) — sinon la
		// somme peut franchir la limite et Discord refuse le message entier.
		const { champs, omises } = champsCatalogue(
			groupes,
			MAX_TOTAL_EMBED - titre.length - entete.length - 200
		);
		const accordOmises = omises > 1 ? "s" : "";
		const description =
			omises > 0
				? `${entete}\n(${omises} famille${accordOmises} non affichée${accordOmises}, faute de place.)`
				: entete;

		const embed = rgEmbed()
			.setTitle(titre)
			.setURL(`${BASE_BOUTIQUE}/shop`)
			.setDescription(truncate(description, MAX_DESCRIPTION));

		for (const champ of champs.slice(0, MAX_CHAMPS_EMBED)) {
			embed.addFields({ name: champ.nom, value: truncate(champ.valeur, MAX_VALEUR_CHAMP) });
		}

		const premier = groupes[0]?.produits[0];
		if (premier) {
			embed.setThumbnail(urlImageProduit(premier.image));
		}
		await interaction.editReply({ embeds: [embed] });
	}

	@Slash({
		description: "La fiche d'un produit : prix, variantes, contenu et lien de commande",
		name: "produit",
	})
	async produit(
		@SlashOption({
			autocomplete: (interaction: AutocompleteInteraction) =>
				repondreSuggestions(interaction, () =>
					chercherProduits(saisie(interaction)).map(choixProduit)
				),
			description: "Nom du produit",
			name: "produit",
			required: true,
			type: ApplicationCommandOptionType.String,
		})
		reference: string,
		interaction: ChatInputCommandInteraction
	): Promise<void> {
		await interaction.deferReply();

		// L'autocomplétion propose un slug, mais rien n'empêche de taper le nom et
		// de valider : `trouverProduit` accepte les deux, puis retombe sur la
		// recherche. Un membre qui écrit le vrai nom d'un produit ne doit pas
		// s'entendre dire qu'il n'existe pas.
		const produit = trouverProduit(reference);
		if (!produit) {
			await interaction.editReply({
				content: `Aucun produit ne correspond à « ${truncate(reference, 80)} ». Essaie \`/boutique catalogue\` pour voir la liste.`,
			});
			return;
		}

		const embed = rgEmbed()
			.setTitle(produit.nom)
			.setURL(urlFicheProduit(produit.slug))
			.setDescription(truncate(`*${produit.accroche}*\n\n${produit.description}`, MAX_DESCRIPTION))
			.setThumbnail(urlImageProduit(produit.image));

		const prix = [
			formaterFourchettePrix(produit),
			libelleStock(produit.stock),
			produit.exclusifPatreon ? "Réservé aux soutiens Patreon" : null,
		]
			.filter((valeur): valeur is string => typeof valeur === "string" && valeur.length > 0)
			.join(" · ");
		embed.addFields(
			{ inline: true, name: "Prix", value: truncate(prix, MAX_VALEUR_CHAMP) },
			{ inline: true, name: "Famille", value: produit.categorieLibelle }
		);

		if (produit.variantes.length > 0) {
			embed.addFields({
				name: `Choix disponibles (${produit.variantes.length})`,
				value: truncate(
					produit.variantes
						.map((variante) => `• ${variante.libelle} — ${formaterEuros(variante.prixCents)}`)
						.join("\n"),
					MAX_VALEUR_CHAMP
				),
			});
		}

		if (produit.points.length > 0) {
			embed.addFields({
				name: "Ce que tu reçois",
				value: truncate(produit.points.map((point) => `• ${point}`).join("\n"), MAX_VALEUR_CHAMP),
			});
		}

		embed.addFields({
			name: "Commander",
			value: `[Fiche et paiement sur le site](${urlFicheProduit(produit.slug)})`,
		});

		await interaction.editReply({ embeds: [embed] });
	}
}
