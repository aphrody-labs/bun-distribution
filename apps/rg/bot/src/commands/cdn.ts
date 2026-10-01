/**
 * `/cdn` — le CDN Rose Griffon depuis Discord.
 *
 * ── CE QUE FAIT VRAIMENT CE CDN ────────────────────────────────────────────
 * `cdn.rosegriffon.fr` n'est pas un dossier de fichiers : c'est un DÉCODEUR.
 * Les textures d'Inazuma Eleven: Victory Road vivent compressées dans des
 * archives CPK ; nginx tente le dump disque puis, à défaut, délègue à
 * `nie-model-serve` qui décode le `g4tx` en PNG à la demande. Les modèles 3D
 * n'existent nulle part sous forme de fichier : ils sont ASSEMBLÉS à la volée
 * (corps + visage + uniforme, textures embarquées) à chaque `/model-full/*.glb`.
 * Rien de tout cela n'était atteignable depuis Discord — ce fichier ouvre les
 * quatre portes utiles.
 *
 * ── LA RÈGLE QUI GOUVERNE TOUT LE FICHIER ──────────────────────────────────
 * On n'embarque JAMAIS l'original. Mesuré le 13/8/2026 sur
 * `/dx11/menu/220_img/gallery_img2/img_story_ev01_main_0010.png` :
 *   PNG brut          11 494 007 octets
 *   `?w=1600&webp`        97 882 octets   (117 fois plus léger)
 *   `?w=400&webp`         12 914 octets
 * Un embed Discord fait chercher l'image par Discord ET par chaque client qui
 * ouvre le salon : servir l'original, c'est mettre 11 Mo sur le dos de tout le
 * monde pour une vignette. Toute image affichée ici passe donc par
 * une variante `?w=` parmi 200/400/800/1600 (largeurs mesurées sur l'ancien
 * service `cdn-variants`, retiré de la pile RG).
 *
 * ── DEUX PIÈGES VÉRIFIÉS, PAS SUPPOSÉS ─────────────────────────────────────
 *  1. `HEAD` est REFUSÉ par le décodeur live (405 sur `/dx11/…png` sans `?w=`)
 *     alors qu'il fonctionne sur une variante (200) et sur `/model-full/`
 *     servi depuis le cache disque. On ne peut donc pas peser un original sans
 *     le télécharger — et on ne le fait pas : le bot n'annonce que le poids
 *     qu'il a réellement observé.
 *  2. Seules les surfaces `dx11/` et `g4tx/` acceptent `?w=`
 *     (`apps/cdn-variants/server.ts` répond 404 ailleurs, et nginx ne route
 *     vers :8805 que depuis ces deux `location`). `static/` et les fichiers
 *     téléversés sont servis en direct, sans déclinaison possible.
 *
 * Toute la logique pure (grammaire des chemins, largeurs, codes de modèle,
 * catégories, pagination) vit dans `lib/cdn-format.ts` et y est testée.
 */
import {
	ButtonComponent,
	Discord,
	Slash,
	SlashChoice,
	SlashGroup,
	SlashOption,
} from "discordx";
import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	type AutocompleteInteraction,
	type ButtonInteraction,
	type ChatInputCommandInteraction,
	type EmbedBuilder,
	MessageFlags,
} from "discord.js";

import { azalee, messageErreurAzalee, urlWiki } from "../lib/azalee";
import { cached } from "../lib/cache";
import {
	ASSET_SONDE,
	CATEGORIES_GALERIE,
	GALERIE_PAR_PAGE,
	LARGEURS_VARIANTE,
	LARGEUR_PLEINE,
	LARGEUR_VIGNETTE,
	LIMITE_PIECE_JOINTE_OCTETS,
	type EtatGalerie,
	type LargeurVariante,
	type SanteCdn,
	bornerPage,
	cheminCdnDepuisCpk,
	choisirTextureModele,
	decoderEtatGalerie,
	decrireSanteCdn,
	encoderEtatGalerie,
	estTypeImage,
	estTypeModele,
	formaterOctets,
	largeurAutorisee,
	libelleCache,
	libelleCategorieGalerie,
	libelleFamille,
	nombreDePages,
	normaliserCheminAsset,
	normaliserCodeModele,
	urlAsset,
	urlModele,
	urlVariante,
} from "../lib/cdn-format";
import { rgEmbed, truncate } from "../lib/embeds";
import { SERVICES, ServiceIndisponibleError, appelService, sonderServices } from "../lib/services";
import { echec, pied, repondre } from "../lib/ui";

/** Base publique du CDN — `CDN_URL`, sinon `https://cdn.rosegriffon.fr`. */
const CDN = SERVICES.cdn.publique;

/**
 * Délai laissé au décodage d'une image.
 *
 * nginx borne la location des variantes à 30 s de lecture et le service abandonne
 * lui-même à 25 s : au-delà de 35 s côté bot, on n'attendrait plus rien. Discord
 * laisse 15 min après `deferReply`, la marge n'est donc pas un problème.
 */
const DELAI_IMAGE_MS = 35_000;

/**
 * Délai laissé à l'assemblage d'un modèle 3D. Un modèle froid est reconstruit
 * depuis les CPK (géométrie + textures BC1-7 converties) avant d'être mis en
 * cache disque ; c'est bien plus long qu'un décodage de texture.
 */
const DELAI_MODELE_MS = 90_000;

/** Vignette d'aperçu d'un modèle : la plus petite largeur servie suffit. */
const LARGEUR_APERCU: LargeurVariante = 200;

/**
 * Budget d'un appel d'AUTOCOMPLÉTION à l'API Azalée.
 *
 * Discord n'accorde que 3 s à une suggestion, alors que le client partagé de
 * `lib/azalee.ts` est calibré sur la rotation nocturne d'`azalee-api.service`
 * (4 tentatives × 8 s, plus les attentes entre essais → plus de 30 s au pire).
 * Sans ce plafond, une API lente laisserait le champ figé sur « chargement… »
 * jusqu'à ce que Discord abandonne. Une suggestion ratée n'a aucune
 * conséquence : le membre peut taper le chemin ou le code à la main.
 */
const APPEL_AUTOCOMPLETION = { attempts: 1, timeoutMs: 1_500 } as const;

/** Choix de largeur proposés par `/cdn image` — la liste fermée du service. */
const CHOIX_LARGEUR = LARGEURS_VARIANTE.map((largeur) => ({
	name: `${largeur} px`,
	value: largeur as number,
}));

/** Choix de catégorie proposés par `/cdn galerie` — les douze catégories peuplées. */
const CHOIX_CATEGORIE = CATEGORIES_GALERIE.map((categorie) => ({
	name: categorie.libelle as string,
	value: categorie.valeur as string,
}));

// ─── Accès HTTP bruts au CDN ────────────────────────────────────────────────

interface ReponseCdn {
	readonly statut: number;
	readonly typeMime: string | null;
	readonly octets: number | null;
	readonly cache: string | null;
	readonly corps: ArrayBuffer | null;
	readonly texte: string | null;
}

/**
 * Récupère une ressource du CDN sans jamais garder en mémoire ce qui est trop
 * gros.
 *
 * `telecharger` n'est vrai que pour un modèle destiné à devenir une pièce
 * jointe, et l'appelant vérifie d'abord `content-length`. Pour une image, on ne
 * lit RIEN : Discord ira la chercher lui-même depuis l'URL de l'embed, le bot
 * n'a besoin que du statut, du type et du poids annoncés.
 */
async function lireCdn(
	url: string,
	options: { delaiMs: number; telecharger?: boolean }
): Promise<ReponseCdn> {
	const reponse = await fetch(url, {
		headers: { accept: "*/*" },
		signal: AbortSignal.timeout(options.delaiMs),
	});
	const typeMime = reponse.headers.get("content-type");
	const annonce = Number.parseInt(reponse.headers.get("content-length") ?? "", 10);
	const cache = reponse.headers.get("x-cache");

	// Une erreur du CDN renvoie un court texte (« modèle … non disponible : … ») :
	// c'est la seule explication utile, on la garde. Sinon on relâche le flux.
	if (!reponse.ok) {
		const texte = (await reponse.text().catch(() => "")).trim();
		return {
			statut: reponse.status,
			typeMime,
			octets: Number.isFinite(annonce) ? annonce : null,
			cache,
			corps: null,
			texte: texte.length > 0 ? texte : null,
		};
	}

	if (!options.telecharger) {
		await reponse.body?.cancel().catch(() => undefined);
		return {
			statut: reponse.status,
			typeMime,
			octets: Number.isFinite(annonce) ? annonce : null,
			cache,
			corps: null,
			texte: null,
		};
	}

	const corps = await reponse.arrayBuffer();
	return {
		statut: reponse.status,
		typeMime,
		octets: corps.byteLength,
		cache,
		corps,
		texte: null,
	};
}

/** Message lisible pour un salon, sans pile d'appels. */
function messageErreurReseau(err: unknown): string {
	if (err instanceof ServiceIndisponibleError) {
		return err.messageLisible;
	}
	if (err instanceof Error) {
		return err.name === "TimeoutError"
			? "Le CDN n'a pas répondu à temps — l'asset est peut-être en cours de décodage, réessaie dans un instant."
			: err.message;
	}
	return String(err);
}

// ─── Autocomplétion ─────────────────────────────────────────────────────────

/** Réponse d'autocomplétion tolérante : une API muette ne doit pas figer la saisie. */
async function repondreSuggestions(
	interaction: AutocompleteInteraction,
	produire: () => Promise<Array<{ name: string; value: string }>>
): Promise<void> {
	try {
		const choix = await produire();
		await interaction.respond(
			choix
				.filter((c) => c.value.length > 0 && c.value.length <= 100)
				.slice(0, 25)
				.map((c) => ({ name: truncate(c.name, 100), value: c.value }))
		);
	} catch {
		await interaction.respond([]);
	}
}

/** Saisie courante de l'option en cours d'autocomplétion. */
function saisie(interaction: AutocompleteInteraction): string {
	const valeur = interaction.options.getFocused();
	return typeof valeur === "string" ? valeur : String(valeur ?? "");
}

interface EntreeCpk {
	path?: string | null;
	name?: string | null;
	ext?: string | null;
}

/**
 * Cherche des textures dans l'index CPK et n'en garde que ce que le CDN sait
 * réellement décliner. `searchFiles` exige au moins deux caractères : sous ce
 * seuil on part d'un préfixe réel (`220_img/`, le dossier des illustrations de
 * menu) plutôt que de rendre une liste vide.
 */
async function suggererTextures(texte: string): Promise<Array<{ name: string; value: string }>> {
	const requete = texte.trim().length >= 2 ? texte.trim() : "220_img/";
	const fichiers = (await azalee().cpkSearch(
		{ q: requete, limit: 120 },
		APPEL_AUTOCOMPLETION
	)) as EntreeCpk[];
	const propositions: Array<{ name: string; value: string }> = [];
	for (const fichier of fichiers) {
		const chemin = cheminCdnDepuisCpk(fichier.path);
		if (chemin && chemin.length <= 100) {
			propositions.push({ name: chemin.slice(1), value: chemin });
		}
		if (propositions.length >= 25) {
			break;
		}
	}
	return propositions;
}

interface EntreePerso {
	internalCode?: string | null;
	names?: { fr?: string | null; en?: string | null; ja?: string | null } | null;
}

/** Nom affichable d'un personnage, français d'abord. */
function nomPerso(perso: EntreePerso): string {
	for (const valeur of [perso.names?.fr, perso.names?.en, perso.names?.ja]) {
		if (typeof valeur === "string" && valeur.trim().length > 0) {
			return valeur.trim();
		}
	}
	return perso.internalCode ?? "Inconnu";
}

/**
 * Propose des codes de modèle : les personnages du wiki par leur NOM (le membre
 * ne connaît pas `c01000010`), et les keshins ou armures dès que la saisie
 * commence par `k`, puisqu'ils n'ont pas de fiche mais existent dans l'index CPK
 * (`_keshin`, 370 dossiers ; `_armd`, 281).
 */
async function suggererCodesModele(texte: string): Promise<Array<{ name: string; value: string }>> {
	const propre = texte.trim();

	if (/^k/i.test(propre)) {
		const fichiers = (await azalee().cpkSearch(
			{ q: propre.length >= 2 ? propre : "chr/_k", limit: 200 },
			APPEL_AUTOCOMPLETION
		)) as EntreeCpk[];
		const codes = new Set<string>();
		for (const fichier of fichiers) {
			const dossier = (fichier.path ?? "").match(/chr\/_(?:keshin|armd)\/(k[a-z]?[0-9]+)\//i);
			if (dossier?.[1]) {
				codes.add(dossier[1].toLowerCase());
			}
			if (codes.size >= 25) {
				break;
			}
		}
		return [...codes].map((code) => ({
			name: `${code} — ${code.startsWith("ka") ? "armure" : "keshin"}`,
			value: code,
		}));
	}

	const liste = await azalee().characters(
		{ q: propre || "a", limit: 25 } as never,
		APPEL_AUTOCOMPLETION
	);
	return (liste.data as unknown as EntreePerso[])
		.filter((perso) => typeof perso.internalCode === "string" && perso.internalCode.length > 0)
		.map((perso) => ({
			name: `${nomPerso(perso)} — ${perso.internalCode}`,
			value: String(perso.internalCode),
		}));
}

// ─── Galerie ────────────────────────────────────────────────────────────────

interface IllustrationGalerie {
	id?: string | null;
	imgPath?: string | null;
	category?: string | null;
	title?: string | null;
	image?: string | null;
	thumb?: string | null;
	full?: string | null;
}

interface PageGalerie {
	data?: IllustrationGalerie[];
	total?: number;
	page?: number;
	limit?: number;
}

/** Une page de la galerie, en cache court : l'API relit la même page à chaque bouton. */
async function lireGalerie(etat: EtatGalerie, page: number): Promise<PageGalerie> {
	const clef = `cdn:galerie:${etat.categorie ?? "-"}:${etat.recherche ?? "-"}:${page}`;
	return await cached<PageGalerie>(clef, 5 * 60_000, async () => {
		return (await azalee().gallery({
			page,
			limit: GALERIE_PAR_PAGE,
			category: etat.categorie ?? undefined,
			q: etat.recherche ?? undefined,
		} as never)) as PageGalerie;
	});
}

/**
 * Rend une page de galerie : un embed d'entête plus un embed par illustration.
 *
 * Chaque illustration a son propre embed pour porter SA vignette — Discord
 * n'affiche qu'une image par embed. Cinq embeds au maximum, très en dessous de
 * la limite de dix par message.
 */
async function rendrePageGalerie(etat: EtatGalerie): Promise<{
	embeds: EmbedBuilder[];
	components: Array<ActionRowBuilder<ButtonBuilder>>;
}> {
	const premier = await lireGalerie(etat, etat.page);
	const total = premier.total ?? 0;
	const page = bornerPage(etat.page, total, GALERIE_PAR_PAGE);
	const resultat = page === (premier.page ?? etat.page) ? premier : await lireGalerie(etat, page);
	const illustrations = resultat.data ?? [];
	const pages = nombreDePages(total, GALERIE_PAR_PAGE);

	const entete = rgEmbed()
		.setTitle(
			`Galerie du jeu — ${total.toLocaleString("fr-FR")} illustration${total > 1 ? "s" : ""}`
		)
		.setURL(urlWiki("/gallery"));

	const criteres = [
		`Catégorie : **${libelleCategorieGalerie(etat.categorie)}**`,
		etat.recherche ? `Recherche : **${truncate(etat.recherche, 60)}**` : null,
	]
		.filter((c): c is string => c !== null)
		.join(" · ");
	entete.setDescription(
		illustrations.length === 0
			? `${criteres}\n\nAucune illustration ne correspond.`
			: `${criteres}\n\nVignettes servies en WebP \`?w=${LARGEUR_VIGNETTE}\` ; le titre de chaque illustration mène à sa version \`?w=${LARGEUR_PLEINE}\`.`
	);
	pied(entete, { page: page, pages: pages });

	const embeds: EmbedBuilder[] = [entete];
	for (const illustration of illustrations) {
		const vignette = illustration.thumb ?? illustration.full ?? null;
		const visuel = rgEmbed().setTitle(truncate(illustration.title ?? "Illustration", 200));
		if (typeof illustration.full === "string" && illustration.full.startsWith("https://")) {
			visuel.setURL(illustration.full);
		}
		visuel.setDescription(
			`\`${truncate(illustration.imgPath ?? "", 180)}\` · ${libelleCategorieGalerie(illustration.category)}`
		);
		if (typeof vignette === "string" && vignette.startsWith("https://")) {
			visuel.setImage(vignette);
		}
		embeds.push(visuel);
	}

	const composants: Array<ActionRowBuilder<ButtonBuilder>> = [];
	const idPrecedent = encoderEtatGalerie({ ...etat, page: page - 1 });
	const idSuivant = encoderEtatGalerie({ ...etat, page: page + 1 });
	if (pages > 1 && idPrecedent && idSuivant) {
		composants.push(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(idPrecedent)
					.setLabel("Précédent")
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(page <= 1),
				new ButtonBuilder()
					.setCustomId(idSuivant)
					.setLabel("Suivant")
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(page >= pages)
			)
		);
	}

	return { embeds, components: composants };
}

// ─── Commandes ──────────────────────────────────────────────────────────────

@Discord()
@SlashGroup({
	name: "cdn",
	description: "Les assets du jeu servis par cdn.rosegriffon.fr : images, modèles 3D, galerie",
})
@SlashGroup("cdn")
export class CdnCommand {
	@Slash({
		name: "image",
		description: "Affiche un asset du CDN en version légère (WebP redimensionné)",
	})
	async image(
		@SlashOption({
			name: "chemin",
			description: "Chemin de l'asset, URL du CDN ou chemin de l'index CPK (data/dx11/…)",
			type: ApplicationCommandOptionType.String,
			required: true,
			autocomplete: (interaction: AutocompleteInteraction) =>
				repondreSuggestions(interaction, () => suggererTextures(saisie(interaction))),
		})
		chemin: string,
		// Les quatre seules largeurs de variante acceptées : toute
		// autre valeur serait de toute façon ramenée à la plus proche par le service.
		@SlashChoice(...CHOIX_LARGEUR)
		@SlashOption({
			name: "largeur",
			description: "Largeur servie, en pixels (200, 400, 800 ou 1600)",
			type: ApplicationCommandOptionType.Integer,
			required: false,
		})
		largeur: number | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await interaction.deferReply();

		const resolution = normaliserCheminAsset(chemin, CDN);
		if (!resolution.ok) {
			await repondre(interaction, echec("La commande a échoué", resolution.raison));
			return;
		}

		const largeurServie = largeurAutorisee(largeur ?? LARGEUR_PLEINE);
		const urlSource = urlAsset(CDN, resolution.chemin);
		const urlAffichee = resolution.variante
			? urlVariante(CDN, resolution.chemin, largeurServie)
			: urlSource;

		try {
			const reponse = await lireCdn(urlAffichee, { delaiMs: DELAI_IMAGE_MS });

			if (reponse.statut !== 200 || !estTypeImage(reponse.typeMime)) {
				await interaction.editReply({
					content:
						`❌ Le CDN n'a pas servi d'image pour \`${truncate(resolution.chemin, 180)}\` ` +
						`(HTTP ${reponse.statut}${reponse.typeMime ? `, ${reponse.typeMime}` : ""}).` +
						(reponse.texte ? `\n> ${truncate(reponse.texte, 200)}` : ""),
				});
				return;
			}

			const nom = resolution.chemin.slice(resolution.chemin.lastIndexOf("/") + 1);
			const embed = rgEmbed()
				.setTitle(truncate(nom, 200))
				.setURL(urlAffichee)
				.setImage(urlAffichee);

			embed.setDescription(
				resolution.variante
					? `Décliné en WebP \`?w=${largeurServie}\` — ${formaterOctets(reponse.octets)}, ${libelleCache(reponse.cache)}.`
					: `Servi en direct par le CDN (surface \`${resolution.surface}\`, aucune déclinaison possible) — ${formaterOctets(reponse.octets)}.`
			);

			embed.addFields({
				name: "Chemin",
				value: `\`${truncate(resolution.chemin, 1000)}\``,
			});

			if (resolution.variante) {
				const autres = LARGEURS_VARIANTE.filter((l) => l !== largeurServie)
					.map((l) => `[${l} px](${urlVariante(CDN, resolution.chemin, l)})`)
					.join(" · ");
				embed.addFields({
					name: "Autres largeurs",
					value: truncate(autres, 1000),
				});
				embed.addFields({
					name: "Source d'origine",
					value:
						`[fichier brut décodé depuis les CPK](${urlSource}) — plusieurs mégaoctets, ` +
						"jamais embarqué ici (un PNG de galerie pèse jusqu'à 11 Mo contre 13 Ko en `?w=400`).",
				});
			}

			if (resolution.depuisCpk) {
				pied(embed, {
					note: "Chemin d'index CPK reconnu : le .g4tx a été résolu vers l'image décodée.",
				});
			}

			await interaction.editReply({ embeds: [embed] });
		} catch (err) {
			await repondre(interaction, echec("Le CDN n'a pas répondu", messageErreurReseau(err)));
		}
	}

	@Slash({
		name: "modele",
		description: "Récupère le modèle 3D complet d'un personnage, d'un keshin ou d'une armure",
	})
	async modele(
		@SlashOption({
			name: "code",
			description: "Code du modèle : personnage (c…), keshin (k…) ou armure (ka…)",
			type: ApplicationCommandOptionType.String,
			required: true,
			autocomplete: (interaction: AutocompleteInteraction) =>
				repondreSuggestions(interaction, () => suggererCodesModele(saisie(interaction))),
		})
		code: string,
		interaction: ChatInputCommandInteraction
	) {
		await interaction.deferReply();

		const resolution = normaliserCodeModele(code);
		if ("raison" in resolution) {
			await repondre(interaction, echec("La commande a échoué", resolution.raison));
			return;
		}

		const url = urlModele(CDN, resolution.code);
		try {
			// On lit d'abord SANS télécharger : un modèle trop lourd pour Discord ne
			// doit pas être chargé en mémoire pour rien.
			const entete = await lireCdn(url, { delaiMs: DELAI_MODELE_MS });

			if (entete.statut !== 200 || !estTypeModele(entete.typeMime)) {
				await interaction.editReply({
					content:
						`❌ Aucun modèle assemblable pour \`${resolution.code}\` (HTTP ${entete.statut}).` +
						(entete.texte ? `\n> ${truncate(entete.texte, 300)}` : "") +
						"\nTous les codes n'ont pas de modèle : le service assemble corps, visage et uniforme, et refuse quand une pièce manque.",
				});
				return;
			}

			const embed = rgEmbed()
				.setTitle(`Modèle 3D — ${resolution.code}`)
				.setURL(url)
				.setDescription(
					`${libelleFamille(resolution.famille)} · glTF binaire assemblé en direct depuis les archives CPK ` +
						"(corps, visage et uniforme réunis, textures embarquées)."
				)
				.addFields(
					{ name: "Poids", value: formaterOctets(entete.octets), inline: true },
					{ name: "Format", value: "`model/gltf-binary`", inline: true }
				);

			// Aperçu : on ne devine PAS le chemin de la texture, on le cherche dans
			// l'index CPK et on ne l'affiche que s'il répond réellement en image.
			const apercu = await this.apercuModele(resolution.code);
			if (apercu) {
				embed.setThumbnail(apercu);
			}

			const trop = (entete.octets ?? Number.POSITIVE_INFINITY) > LIMITE_PIECE_JOINTE_OCTETS;
			if (trop) {
				embed.addFields({
					name: "Téléchargement",
					value: `[Ouvrir le modèle](${url}) — trop lourd pour une pièce jointe Discord (${formaterOctets(LIMITE_PIECE_JOINTE_OCTETS)} au maximum).`,
				});
				await interaction.editReply({ embeds: [embed] });
				return;
			}

			const complet = await lireCdn(url, { delaiMs: DELAI_MODELE_MS, telecharger: true });
			if (complet.corps === null || complet.corps.byteLength > LIMITE_PIECE_JOINTE_OCTETS) {
				embed.addFields({ name: "Téléchargement", value: `[Ouvrir le modèle](${url})` });
				await interaction.editReply({ embeds: [embed] });
				return;
			}

			const fichier = new AttachmentBuilder(Buffer.from(complet.corps), {
				name: `${resolution.code}.glb`,
			});
			embed.addFields({
				name: "Téléchargement",
				value: `Joint à ce message · [ou depuis le CDN](${url})`,
			});
			await interaction.editReply({ embeds: [embed], files: [fichier] });
		} catch (err) {
			await repondre(interaction, echec("Le CDN n'a pas répondu", messageErreurReseau(err)));
		}
	}

	/**
	 * URL d'aperçu d'un modèle, ou `null`.
	 *
	 * Deux garde-fous : le chemin vient de l'index CPK réel (pas d'une règle
	 * devinée par famille, elles diffèrent), et il n'est retenu qu'après une
	 * réponse 200 en image — un aperçu cassé dans un embed est pire que pas
	 * d'aperçu du tout.
	 */
	private async apercuModele(code: string): Promise<string | null> {
		try {
			const fichiers = (await azalee().cpkSearch({ q: code, limit: 60 })) as EntreeCpk[];
			const chemin = choisirTextureModele(code, fichiers);
			if (!chemin) {
				return null;
			}
			const url = urlVariante(CDN, chemin, LARGEUR_APERCU);
			const reponse = await lireCdn(url, { delaiMs: DELAI_IMAGE_MS });
			return reponse.statut === 200 && estTypeImage(reponse.typeMime) ? url : null;
		} catch {
			return null;
		}
	}

	@Slash({
		name: "galerie",
		description: "Parcourt les illustrations du jeu, page par page",
	})
	async galerie(
		@SlashChoice(...CHOIX_CATEGORIE)
		@SlashOption({
			name: "categorie",
			description: "Restreint à une catégorie d'illustrations",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		categorie: string | undefined,
		@SlashOption({
			name: "recherche",
			description: "Filtre sur le nom du fichier de l'illustration",
			type: ApplicationCommandOptionType.String,
			required: false,
		})
		recherche: string | undefined,
		@SlashOption({
			name: "page",
			description: "Numéro de page (1 par défaut)",
			type: ApplicationCommandOptionType.Integer,
			required: false,
			minValue: 1,
		})
		page: number | undefined,
		interaction: ChatInputCommandInteraction
	) {
		await interaction.deferReply();
		try {
			await interaction.editReply(
				await rendrePageGalerie({
					page: page ?? 1,
					categorie: categorie ?? null,
					recherche: recherche?.trim() || null,
				})
			);
		} catch (err) {
			await repondre(interaction, echec("Données de jeu indisponibles", messageErreurAzalee(err)));
		}
	}

	/**
	 * Boutons de pagination. Tout l'état tient dans le `customId` : aucune mémoire
	 * de processus à conserver, donc un redémarrage du bot ne laisse jamais de
	 * bouton mort.
	 */
	@ButtonComponent({ id: /^cdng\|/ })
	async paginerGalerie(interaction: ButtonInteraction) {
		const etat = decoderEtatGalerie(interaction.customId);
		if (!etat) {
			await interaction.reply({ content: "Pagination illisible.", flags: MessageFlags.Ephemeral });
			return;
		}
		await interaction.deferUpdate();
		try {
			await interaction.editReply(await rendrePageGalerie(etat));
		} catch (err) {
			await interaction.followUp({
				content: `❌ ${messageErreurAzalee(err)}`,
				flags: MessageFlags.Ephemeral,
			});
		}
	}

	@Slash({
		name: "etat",
		description: "Santé du CDN : stockage, manifeste d'assets, latence",
	})
	async etat(interaction: ChatInputCommandInteraction) {
		await interaction.deferReply();
		try {
			await interaction.editReply(await this.rendreEtat());
		} catch (err) {
			// Sans ce filet, une panne inattendue laisserait l'interaction sur
			// « réfléchit… » pendant quinze minutes, sans un mot d'explication.
			await repondre(interaction, echec("Le CDN n'a pas répondu", messageErreurReseau(err)));
		}
	}

	/** Construit l'embed d'état, sondes comprises. */
	private async rendreEtat(): Promise<{ embeds: EmbedBuilder[] }> {
		const [sondes, sante, sonde] = await Promise.all([
			sonderServices([SERVICES.cdn]),
			this.santeCdn(),
			this.sondeBoutEnBout(),
		]);

		const embed = rgEmbed()
			.setTitle("État du CDN")
			.setURL(CDN)
			.setDescription(
				"`cdn.rosegriffon.fr` décode les archives CPK du jeu à la demande : aucun asset " +
					"n'a besoin d'exister sur disque pour être servi."
			);

		for (const resultat of sondes) {
			const etat = resultat.ok ? "✅ en ligne" : "❌ injoignable";
			const detail = resultat.ok
				? `${etat} · ${resultat.latenceMs} ms`
				: `${etat} · ${resultat.erreur ?? "cause inconnue"}`;
			const lignes = decrireSanteCdn(sante);
			embed.addFields({
				name: `${resultat.service.titre} — ${resultat.service.unite ?? "sans unité"}`,
				value: truncate([detail, ...lignes].join("\n"), 1000),
			});
		}

		embed.addFields({
			name: "Sonde de bout en bout",
			value: truncate(sonde, 1000),
		});

		return { embeds: [embed] };
	}

	/** Charge de santé de `rg-cdn`, telle qu'il la renvoie. */
	private async santeCdn(): Promise<SanteCdn | null> {
		try {
			return await appelService<SanteCdn>("cdn", "/health", { tentatives: 1, delaiMs: 3_000 });
		} catch {
			return null;
		}
	}

	/**
	 * Vérifie la chaîne COMPLÈTE — nginx public, service de variantes, décodeur —
	 * sur un asset réel. Un `/health` prouve qu'un port répond ; seule une image
	 * réellement servie prouve que le décodage marche.
	 */
	private async sondeBoutEnBout(): Promise<string> {
		const url = urlVariante(CDN, ASSET_SONDE, LARGEUR_APERCU);
		const debut = Bun.nanoseconds();
		try {
			const reponse = await lireCdn(url, { delaiMs: DELAI_IMAGE_MS });
			const ms = Math.round((Bun.nanoseconds() - debut) / 1e6);
			if (reponse.statut !== 200 || !estTypeImage(reponse.typeMime)) {
				return `❌ \`${ASSET_SONDE}\` → HTTP ${reponse.statut}${reponse.typeMime ? ` (${reponse.typeMime})` : ""}`;
			}
			return (
				`✅ \`${ASSET_SONDE}?w=${LARGEUR_APERCU}\` → ${formaterOctets(reponse.octets)} ` +
				`en ${ms} ms, ${libelleCache(reponse.cache)}.`
			);
		} catch (err) {
			return `❌ ${messageErreurReseau(err)}`;
		}
	}
}
