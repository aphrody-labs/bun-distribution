/**
 * Valeurs stockées en `smallint` (colonnes `notification.type` / `.category`, sans
 * contrainte CHECK) : **toujours ajouter à la fin**, jamais réordonner — un décalage
 * réétiquetterait silencieusement toutes les notifications déjà en base.
 */
export enum NotificationType {
	NEW_ORGANIZATION_CREATION_REQUEST,
	NEW_ORGANIZATION_EDITION_REQUEST,
	NEW_ORGANIZATION_EDIT_REPLY,
	NEW_ORGANIZATION_ACCEPT_REPLY,
	NEW_ORGANIZATION_REJECT_REPLY,
	CLAN_MEMBER_KICK,
	TOURNAMENT_WAITLIST_PROMOTED,
	TOURNAMENT_DISQUALIFIED,
	TOURNAMENT_CANCELED,
}

export enum NotificationCategory {
	USER,
	CLAN,
	GLOBAL,
	ORGANIZATION,
	TOURNAMENT,
}
