/**
 * Jetons de présentation des deux bots — la SEULE source de couleurs, d'icônes
 * et de limites.
 *
 * ── POURQUOI CE MODULE ─────────────────────────────────────────────────────
 * Un serveur de plus de deux mille membres lit les réponses du bot en diagonale,
 * sur mobile, entre deux messages. Ce qui rend une réponse lisible n'est pas la
 * richesse d'un embed isolé mais la RÉPÉTITION : la même couleur veut toujours
 * dire la même chose, l'icône de tête annonce toujours la même nature de
 * réponse, le pied porte toujours la commande qui l'a produite. Écrites
 * commande par commande, ces conventions divergent en quelques semaines — on a
 * relevé dans ce dépôt trois formes de pied de page différentes pour une même
 * liste paginée.
 *
 * Ici : des jetons, purs, testables, importés partout. Aucune commande ne doit
 * écrire une couleur hexadécimale, une émoji d'état ou une limite Discord en
 * dur — c'est la règle équivalente au « zéro couleur en dur » du design system
 * web (`packages/ui`).
 *
 * ── MODULE PUR ─────────────────────────────────────────────────────────────
 * Aucun import de `discord.js`, aucune E/S.
 *
 * Il lit le profil par `lib/profil.ts` et NON par `lib/config.ts`, alors que
 * ce dernier expose déjà `RG_COLOR` et `RG_FOOTER` : `config` résout aussi le
 * JETON à l'import et lève quand il manque. La trousse serait alors
 * inutilisable en test et en intégration continue, où aucun secret n'est posé —
 * or c'est justement ce qu'on veut pouvoir couvrir sans bot allumé.
 */
import { couleurDeMarque, profilActif } from "../profil";

const PROFIL = profilActif();

// ─── Couleurs ───────────────────────────────────────────────────────────────

/**
 * Nature d'une réponse. Elle décide de la couleur de la barre latérale et de
 * l'icône du titre — jamais du contenu, qui doit rester lisible en noir et
 * blanc (daltonisme, thème clair, capture d'écran compressée).
 */
export type Intention = "marque" | "succes" | "attention" | "echec" | "info" | "muet";

/**
 * Palette d'état.
 *
 * Ces quatre valeurs sont celles du nuancier Discord (succès, avertissement,
 * danger, accent). Ce n'est pas de la paresse : un membre les a déjà apprises
 * dans le client lui-même — les bannières de permission, les erreurs de
 * formulaire, les messages système — et un rouge « maison » à peine différent
 * ferait hésiter là où il faut décider. La charte Rose Griffon, elle, garde
 * `marque` : c'est la couleur du profil, donc celle des réponses NORMALES, qui
 * sont l'écrasante majorité.
 */
export const COULEURS: Readonly<Record<Intention, number>> = Object.freeze({
	marque: couleurDeMarque(PROFIL.marque.couleurHex),
	succes: 0x3b_a5_5d,
	attention: 0xfa_a6_1a,
	echec: 0xed_42_45,
	info: 0x58_65_f2,
	// Gris « embed » : la même valeur que le fond des embeds en thème sombre, donc
	// une barre latérale qui disparaît. Pour ce qui est vrai mais accessoire.
	muet: 0x2b_2d_31,
});

// ─── Icônes ─────────────────────────────────────────────────────────────────

/**
 * Lexique d'icônes. UNE icône par idée, jamais deux.
 *
 * Elles sont toutes des émojis Unicode, jamais des émojis personnalisées du
 * serveur : une émoji custom ne s'affiche que pour qui a accès au serveur qui
 * la porte, et les deux bots servent deux serveurs.
 */
export const ICONES = Object.freeze({
	// États d'une réponse
	succes: "✅",
	echec: "❌",
	attention: "⚠️",
	info: "ℹ️",
	patiente: "⏳",
	vide: "🫥",
	interdit: "🚫",
	// Objets récurrents du domaine
	membre: "👤",
	equipe: "🛡️",
	article: "📝",
	agenda: "📅",
	boutique: "🛍️",
	sondage: "📊",
	campagne: "💛",
	post: "🐦",
	jeu: "🎮",
	// Vie de communauté
	niveau: "⭐",
	// 💛 est déjà pris par `campagne` : une icône par idée, jamais deux.
	kizuna: "🤝",
	collection: "🎴",
	classement: "🏆",
	ticket: "🎫",
	fichier: "📁",
	image: "🖼️",
	modele: "🧊",
	recherche: "🔎",
	lien: "🔗",
	// Exploitation
	service: "🩺",
	deploiement: "🚀",
	tache: "⏱️",
	journal: "🧾",
	reglage: "🎛️",
	// Pastilles d'état, à utiliser en début de ligne de liste
	enLigne: "🟢",
	degrade: "🟡",
	horsLigne: "🔴",
	inconnu: "⚪",
} as const);

export type NomIcone = keyof typeof ICONES;

/** Icône par défaut d'une intention, quand l'appelant n'en impose pas. */
export const ICONE_INTENTION: Readonly<Record<Intention, string>> = Object.freeze({
	marque: "",
	succes: ICONES.succes,
	attention: ICONES.attention,
	echec: ICONES.echec,
	info: ICONES.info,
	muet: "",
});

// ─── Typographie ────────────────────────────────────────────────────────────

/**
 * Séparateur d'inline : point médian entouré d'espaces.
 *
 * Le tiret cadratin et la barre verticale ont été écartés — le premier se
 * confond avec un tiret de négation dans les valeurs numériques (`-3 · +2`), la
 * seconde avec la syntaxe de spoiler `||`.
 */
export const SEPARATEUR = " · ";

/** Valeur absente. Un champ vide serait refusé par l'API ; ce tiret ne l'est pas. */
export const ABSENT = "—";

/** Puce de liste. Discord rend `- ` en vraie liste depuis le Markdown de 2024. */
export const PUCE = "- ";

// ─── Marque ─────────────────────────────────────────────────────────────────

/** Identité affichée dans les pieds de page et les en-têtes d'auteur. */
export interface Marque {
	/** Nom lisible du bot, tel qu'il doit apparaître au membre. */
	readonly nom: string;
	/** Domaine public correspondant. */
	readonly domaine: string;
	/** Icône ronde de 16 px affichée à côté du pied — URL absolue, servie en 200. */
	readonly icone: string;
}

/**
 * Icônes de marque.
 *
 * Deux fichiers déjà publiés par les apps (vérifié en HTTP le 13/8/2026 :
 * `200 image/webp` sur les deux). Les héberger ailleurs ajouterait une surface
 * à surveiller pour une image de seize pixels.
 */
const ICONES_MARQUE: Readonly<Record<string, string>> = Object.freeze({
	rg: "https://rosegriffon.fr/RG_Logo_V2.5.webp",
	azalee: "https://azalee.rosegriffon.fr/RG_Azalee-logo.webp",
});

export const MARQUE: Marque = Object.freeze({
	nom: PROFIL.titre,
	domaine: PROFIL.marque.piedDePage,
	icone: ICONES_MARQUE[PROFIL.nom] ?? ICONES_MARQUE.rg!,
});

// ─── Limites DURES de l'API Discord ─────────────────────────────────────────

/**
 * Dépasser l'une d'elles ne tronque pas : l'API REFUSE le message entier, et le
 * membre ne voit rien du tout — pas même une erreur partielle. Tout ce qui
 * construit un embed dans ce dépôt passe donc par `lib/ui/embed.ts`, qui borne.
 */
export const LIMITES = Object.freeze({
	titre: 256,
	description: 4096,
	nomChamp: 256,
	valeurChamp: 1024,
	champs: 25,
	pied: 2048,
	auteur: 256,
	/** Somme de titre + description + nom et valeur de TOUS les champs + pied + auteur. */
	total: 6000,
	/** Contenu texte d'un message (hors embed). */
	contenu: 2000,
	/** Propositions d'autocomplétion, et longueur de chacune. */
	propositions: 25,
	longueurProposition: 100,
	/** Identifiant de composant — au-delà, le composant est refusé. */
	identifiantComposant: 100,
	/** Libellé d'un bouton. */
	libelleBouton: 80,
	/** Composants par rangée, et rangées par message. */
	composantsParRangee: 5,
	rangees: 5,
} as const);

/**
 * Marge gardée sous `LIMITES.total`.
 *
 * Discord compte quelques caractères de structure que l'on ne voit pas depuis
 * le code ; viser 6 000 pile, c'est se faire refuser au caractère près, sur la
 * réponse la plus longue, donc la plus utile.
 */
export const MARGE_TOTAL = 200;

/** Budget réellement utilisable par un embed. */
export const BUDGET_EMBED = LIMITES.total - MARGE_TOTAL;
