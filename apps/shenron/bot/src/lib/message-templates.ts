/**
 * Catalogue centralisé des événements pour lesquels le bot envoie un message.
 *
 * Chaque entrée déclare :
 *   - `event`        — clé unique (PK de `message_templates`)
 *   - `description`  — affiché dans le dashboard
 *   - `defaultTemplate` — texte FR par défaut, avec placeholders `{var}`
 *   - `defaultChannelKey` — clé `guild_settings` du salon par défaut
 *   - `variables`    — liste des placeholders supportés (pour la doc UI)
 *   - `embed`        — true si le message doit être rendu dans un EmbedBuilder
 *
 * Le `MessageTemplateService` charge la table `message_templates` (cache 30s),
 * fusionne avec les défauts ci-dessous et expose `render(event, vars)`.
 */

export interface EventDef {
	event: string;
	description: string;
	defaultTemplate: string;
	/**
	 * Clé du canal cible. Trois clés "virtuelles" indiquent que le canal n'est
	 * PAS résolu via guild_settings : le caller fournit son propre canal.
	 *   - `channel.dm`         → DM envoyé au membre concerné
	 *   - `channel.invocation` → canal où la commande a été lancée
	 *   - `channel.ticket`     → canal du ticket nouvellement créé
	 */
	defaultChannelKey:
		| "channel.announce"
		| "channel.achievement"
		| "channel.level"
		| "channel.welcome"
		| "channel.farewell"
		| "channel.giveaway"
		| "channel.zeni"
		| "channel.mod_notify"
		| "channel.log_sanction"
		| "channel.dm"
		| "channel.invocation"
		| "channel.ticket";
	variables: { name: string; description: string }[];
	embed: boolean;
}

/**
 * Clés "virtuelles" : pas de résolution via guild_settings, le caller fournit
 * son propre canal (DM, canal d'invocation, canal du ticket). Le service ne
 * tente PAS de fallback env.
 */
export const VIRTUAL_CHANNEL_KEYS = new Set(["channel.dm", "channel.invocation", "channel.ticket"]);

export const EVENTS: readonly EventDef[] = [
	{
		event: "welcome",
		description: "Message d'accueil pour un nouveau membre",
		defaultTemplate:
			"Bienvenue {user} sur **{guildName}** ! Tu es notre {memberCount}ème guerrier.",
		defaultChannelKey: "channel.welcome",
		variables: [
			{ name: "user", description: "Mention du membre (<@id>)" },
			{ name: "userName", description: "Pseudo affiché" },
			{ name: "userId", description: "ID Discord du membre" },
			{ name: "guildName", description: "Nom du serveur" },
			{ name: "memberCount", description: "Nombre total de membres" },
			{ name: "inviter", description: "Mention de l'invitant si tracké" },
		],
		embed: true,
	},
	{
		event: "farewell",
		description: "Message de départ quand un membre quitte le serveur",
		defaultTemplate: "{userName} a quitté le serveur. Adieu, guerrier.",
		defaultChannelKey: "channel.farewell",
		variables: [
			{ name: "userName", description: "Pseudo du membre parti" },
			{ name: "userId", description: "ID Discord" },
			{ name: "memberCount", description: "Nombre restant" },
		],
		embed: true,
	},
	{
		event: "level_up",
		description: "Annonce de passage de palier (niveau XP)",
		defaultTemplate: "{user} a atteint **{xp} XP** — palier {level} débloqué !",
		defaultChannelKey: "channel.level",
		variables: [
			{ name: "user", description: "Mention du membre" },
			{ name: "userName", description: "Pseudo" },
			{ name: "level", description: "Nouveau niveau atteint (1-10)" },
			{ name: "xp", description: "XP totale du membre" },
			{ name: "roleId", description: "ID du rôle attribué" },
			{ name: "zeniBonus", description: "Bonus zénis offert" },
		],
		embed: true,
	},
	{
		event: "achievement_unlocked",
		description: "Débloquage d'un succès",
		defaultTemplate: "{user} débloque l'accomplissement **{code}** !",
		defaultChannelKey: "channel.achievement",
		variables: [
			{ name: "user", description: "Mention du membre" },
			{ name: "userName", description: "Pseudo" },
			{ name: "code", description: "Code du succès (ex: KAMEHAMEHA)" },
			{
				name: "description",
				description: "Description du succès si configurée",
			},
		],
		embed: true,
	},
	{
		event: "first_message",
		description: "Premier message d'un membre (auto-attribué)",
		defaultTemplate: "{user} débloque l'accomplissement **Premier message** !",
		defaultChannelKey: "channel.achievement",
		variables: [
			{ name: "user", description: "Mention du membre" },
			{ name: "userName", description: "Pseudo" },
		],
		embed: true,
	},
	{
		event: "daily_quest",
		description: "Récompense de la quête quotidienne (premier message du jour)",
		defaultTemplate:
			"{user} récupère **{zeni} Ƶ** pour son entraînement quotidien (streak {streak} jours).",
		defaultChannelKey: "channel.zeni",
		variables: [
			{ name: "user", description: "Mention" },
			{ name: "zeni", description: "Zénis gagnés" },
			{ name: "streak", description: "Jours consécutifs" },
		],
		embed: true,
	},
	{
		event: "zeni_drop",
		description: "Drop aléatoire de zenis sur message (probabilité zeni.message_chance)",
		defaultTemplate: "💰 {user} ramasse **{zeni} Ƶ** !",
		defaultChannelKey: "channel.zeni",
		variables: [
			{ name: "user", description: "Mention du chanceux" },
			{ name: "zeni", description: "Montant droppé" },
		],
		embed: true,
	},
	{
		event: "zeni_game_win",
		description: "Victoire à un jeu (Bingo/Morpion/Pendu/Pfc) — annonce centralisée",
		defaultTemplate: "🏆 {user} gagne **{zeni} Ƶ** au {game} !",
		defaultChannelKey: "channel.zeni",
		variables: [
			{ name: "user", description: "Mention du gagnant" },
			{ name: "zeni", description: "Gain" },
			{ name: "game", description: "Nom du jeu (bingo/morpion/pendu/pfc)" },
		],
		embed: true,
	},
	{
		event: "anti_link_jail",
		description: "Auto-jail quand un lien Discord externe est posté",
		defaultTemplate: "{user} a été jailé automatiquement (lien Discord externe détecté).",
		defaultChannelKey: "channel.log_sanction",
		variables: [
			{ name: "user", description: "Mention" },
			{ name: "url", description: "URL détectée" },
		],
		embed: true,
	},
	{
		event: "jail_expired",
		description: "Auto-déjail à l'expiration de la peine",
		defaultTemplate: "{user} a été libéré du jail (peine expirée).",
		defaultChannelKey: "channel.log_sanction",
		variables: [
			{ name: "user", description: "Mention" },
			{ name: "userName", description: "Pseudo" },
			{ name: "duration", description: "Durée de la peine" },
		],
		embed: true,
	},
	{
		event: "giveaway_winner",
		description: "Annonce du gagnant d'un tirage",
		defaultTemplate: "Tirage terminé ! {winners} remporte(nt) **{prize}** ! Bravo guerriers.",
		defaultChannelKey: "channel.giveaway",
		variables: [
			{ name: "winners", description: "Liste des mentions gagnantes" },
			{ name: "prize", description: "Lot mis en jeu" },
			{ name: "title", description: "Titre du tirage" },
		],
		embed: true,
	},
	{
		event: "vocal_tempo_created",
		description: "Création d'un vocal éphémère",
		defaultTemplate: "Vocal éphémère créé pour {user}.",
		defaultChannelKey: "channel.announce",
		variables: [
			{ name: "user", description: "Mention du créateur" },
			{ name: "channelId", description: "ID du salon vocal" },
		],
		embed: true,
	},
	{
		event: "vocal_tempo_destroyed",
		description: "Suppression d'un vocal éphémère vide",
		defaultTemplate: "Vocal éphémère supprimé (inactivité 60s).",
		defaultChannelKey: "channel.announce",
		variables: [{ name: "channelId", description: "ID du salon supprimé" }],
		embed: true,
	},
	{
		event: "sleepcall_start",
		description: "Début d'un sleepcall (vocal à plusieurs pendant la nuit, boost d'XP)",
		defaultTemplate:
			"🌙 Sleepcall lancé dans <#{channelId}> ({members} membres) : XP vocale {multiplier} jusqu'à {endHour} h, micro et casque coupés compris.",
		defaultChannelKey: "channel.level",
		variables: [
			{ name: "channelId", description: "ID du salon vocal" },
			{ name: "members", description: "Membres présents au lancement" },
			{ name: "multiplier", description: "Multiplicateur du sleepcall (ex: ×2,5)" },
			{ name: "endHour", description: "Heure de fin de la nuit" },
		],
		embed: true,
	},
	{
		event: "sleepcall_end",
		description: "Fin d'un sleepcall d'au moins 15 minutes, avec son bilan",
		defaultTemplate:
			"☀️ Fin du sleepcall dans <#{channelId}> : {duration} à {participants}, {xp} XP gagnés au total.",
		defaultChannelKey: "channel.level",
		variables: [
			{ name: "channelId", description: "ID du salon vocal" },
			{ name: "duration", description: "Durée du sleepcall" },
			{ name: "participants", description: "Nombre de participants" },
			{ name: "xp", description: "XP gagnée par l'ensemble des participants" },
		],
		embed: true,
	},
	{
		event: "mod_sanction_dm",
		description: "DM envoyé au membre sanctionné (warn/jail/timeout/ban/kick)",
		defaultTemplate:
			"Tu viens de recevoir un **{kind}** sur **{guildName}**.\n**Raison :** {reason}",
		defaultChannelKey: "channel.dm",
		variables: [
			{
				name: "kind",
				description: "Type de sanction (warn/jail/ban/kick/timeout)",
			},
			{ name: "reason", description: "Raison fournie par le modérateur" },
			{ name: "duration", description: "Durée si applicable (jail/timeout)" },
			{ name: "moderator", description: "Pseudo du modérateur" },
			{ name: "guildName", description: "Nom du serveur" },
		],
		embed: true,
	},
	{
		event: "mod_purge_announce",
		description: "Annonce publique d'une purge dans le salon d'invocation",
		defaultTemplate: "<@{moderator}> a purgé **{deleted}** message(s){targetClause}.",
		defaultChannelKey: "channel.invocation",
		variables: [
			{
				name: "moderator",
				description: "ID du modérateur ayant lancé la purge",
			},
			{ name: "deleted", description: "Nombre de messages supprimés" },
			{
				name: "target",
				description: "ID de la cible si spécifiée, sinon vide",
			},
			{
				name: "targetClause",
				description: "Suffixe FR ' de <@id>' si cible, sinon vide",
			},
			{ name: "scope", description: "'#salon' ou 'global'" },
		],
		embed: true,
	},
	{
		event: "ticket_opened",
		description: "Message d'accueil dans le canal d'un ticket fraîchement créé",
		defaultTemplate:
			"<@{ownerId}> bienvenue dans votre ticket **{kind}**.\n**Contexte :** {context}",
		defaultChannelKey: "channel.ticket",
		variables: [
			{ name: "ownerId", description: "ID du créateur du ticket" },
			{ name: "kind", description: "Catégorie du ticket" },
			{ name: "context", description: "Contexte fourni à l'ouverture" },
		],
		embed: true,
	},
] as const;

export function findEvent(event: string): EventDef | undefined {
	return EVENTS.find((e) => e.event === event);
}

/**
 * Substitution `{var}` → valeur. Variables manquantes laissées telles quelles
 * pour faciliter le debug. Échappe rien — les templates sont admin-only donc
 * pas d'XSS, et le contenu va dans Discord (pas du HTML).
 */
export function renderTemplate(template: string, vars: Record<string, unknown>): string {
	return template.replace(/\{(\w+)\}/g, (m, key) => {
		const v = vars[key];
		if (v === undefined || v === null) return m;
		return String(v);
	});
}
