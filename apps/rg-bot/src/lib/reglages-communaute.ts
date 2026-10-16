/**
 * Réglages de communauté d'une guilde — RÉEXPORT du contrat partagé.
 *
 * ── POURQUOI CE FICHIER NE CONTIENT PLUS LE SCHÉMA ─────────────────────────
 * `bot_reglages_guilde.valeurs` est un `jsonb`, et il a désormais DEUX
 * écrivains : les commandes `/administration réglages` du bot, et le formulaire
 * `/admin/bot/reglages` du site. Un schéma défini ici et recopié là-bas serait
 * la garantie qu'un jour le formulaire écrit une valeur que le bot refuse de
 * relire — et comme `lireReglages` ne lève jamais, le bot retomberait
 * silencieusement sur ses défauts en effaçant en pratique tout réglage posé.
 *
 * Le schéma vit donc dans `@rosegriffon/types/bot`, une seule fois, et les deux
 * surfaces l'appliquent à l'identique. Ce module reste en place parce qu'une
 * quarantaine de fichiers l'importent par ce chemin : le déplacer aurait
 * transformé un refactor de contrat en un balayage de tout `apps/bot`.
 *
 * Rien à ajouter ici. Toute évolution du schéma se fait dans
 * `packages/types/src/bot.ts`.
 */
export {
	fusionnerReglages,
	LIEUX_ANNONCE,
	LIEUX_BIENVENUE,
	lireReglages,
	manquesParSection,
	manquesTickets,
	REGLAGES_DEFAUT,
	SchemaReglages,
	SchemaModificationReglages,
	SECTIONS_REGLAGES,
	validerReglages,
	type LieuAnnonce,
	type LieuBienvenue,
	type ModificationReglages,
	type ReglagesCommunaute,
	type SectionReglages,
} from "@rosegriffon/types/bot";
