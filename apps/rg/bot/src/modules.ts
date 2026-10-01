/**
 * Table des chargeurs de modules pour @rosegriffon/bot.
 *
 * Permet à `bun build --compile` de résoudre statiquement tous les modules
 * de commandes et d'événements lors de la compilation en binaire natif autonome,
 * tout en conservant le chargement dynamique par profil (rg vs azalee) au runtime.
 */
export const MODULE_LOADERS: Record<string, () => Promise<unknown>> = {
	// Profil Azalée
	"commands/azalee-jeu.ts": () => import("./commands/azalee-jeu"),
	"commands/cpk.ts": () => import("./commands/cpk"),
	"commands/cdn.ts": () => import("./commands/cdn"),
	"commands/x.ts": () => import("./commands/x"),
	"commands/validation-annonce.ts": () => import("./commands/validation-annonce"),

	// Profil Rose Griffon
	"commands/achillea.ts": () => import("./commands/achillea"),
	"commands/administration/racine.ts": () => import("./commands/administration/racine"),
	"commands/administration/racine-gestion.ts": () => import("./commands/administration/racine-gestion"),
	"commands/administration/racine-moderation.ts": () => import("./commands/administration/racine-moderation"),
	"commands/administration/article.ts": () => import("./commands/administration/article"),
	"commands/administration/cron.ts": () => import("./commands/administration/cron"),
	"commands/administration/equipe.ts": () => import("./commands/administration/equipe"),
	"commands/administration/evenement.ts": () => import("./commands/administration/evenement"),
	"commands/administration/moderation.ts": () => import("./commands/administration/moderation"),
	"commands/administration/multicomptes.ts": () => import("./commands/administration/multicomptes"),
	"commands/administration/reglages.ts": () => import("./commands/administration/reglages"),
	"commands/administration/role.ts": () => import("./commands/administration/role"),
	"commands/administration/salon.ts": () => import("./commands/administration/salon"),
	"commands/administration/sondage.ts": () => import("./commands/administration/sondage"),
	"commands/administration/ticket.ts": () => import("./commands/administration/ticket"),
	"commands/administration/niveaux.ts": () => import("./commands/administration/niveaux"),
	"commands/administration/roles.ts": () => import("./commands/administration/roles"),
	"commands/administration/accueil.ts": () => import("./commands/administration/accueil"),
	"commands/administration/historique.ts": () => import("./commands/administration/historique"),
	"commands/administration/journal.ts": () => import("./commands/administration/journal"),
	"commands/administration/automod.ts": () => import("./commands/administration/automod"),
	"commands/administration/suggestion.ts": () => import("./commands/administration/suggestion"),
	"commands/administration/stream.ts": () => import("./commands/administration/stream"),
	"commands/administration/synchroniser.ts": () => import("./commands/administration/synchroniser"),
	"commands/administration/utilisateur.ts": () => import("./commands/administration/utilisateur"),
	"commands/administration/veille.ts": () => import("./commands/administration/veille"),
	"commands/agenda.ts": () => import("./commands/agenda"),
	"commands/article.ts": () => import("./commands/article"),
	"commands/staff/racine.ts": () => import("./commands/staff/racine"),
	"commands/staff/cron.ts": () => import("./commands/staff/cron"),
	"commands/staff/discord.ts": () => import("./commands/staff/discord"),
	"commands/staff/services.ts": () => import("./commands/staff/services"),
	"commands/staff/stats.ts": () => import("./commands/staff/stats"),
	"commands/staff/veille.ts": () => import("./commands/staff/veille"),
	"commands/staff/web.ts": () => import("./commands/staff/web"),
	"commands/boutique.ts": () => import("./commands/boutique"),
	"commands/campagne.ts": () => import("./commands/campagne"),
	"commands/equipe.ts": () => import("./commands/equipe"),
	"commands/membre.ts": () => import("./commands/membre"),
	"commands/patreon.ts": () => import("./commands/patreon"),
	"commands/sondage.ts": () => import("./commands/sondage"),
	"commands/suggestion.ts": () => import("./commands/suggestion"),
	"commands/profil.ts": () => import("./commands/profil"),
	"commands/kizuna.ts": () => import("./commands/kizuna"),
	"commands/collection.ts": () => import("./commands/collection"),
	"commands/ticket.ts": () => import("./commands/ticket"),

	// Événements RG
	"events/ready.ts": () => import("./events/ready"),
	"events/memberEvents.ts": () => import("./events/memberEvents"),
	"events/experience.ts": () => import("./events/experience"),
	"events/accueil.ts": () => import("./events/accueil"),
};
