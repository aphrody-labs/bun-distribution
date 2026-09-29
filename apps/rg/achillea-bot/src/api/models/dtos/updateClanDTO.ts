import { Property } from "@tsed/schema";

/** Champs modifiables depuis l'onglet "Infos" du dashboard de clan (PATCH /clans/:id). */
export class UpdateClanDTO {
	@Property()
	name?: string;

	@Property()
	shortenedName?: string;

	@Property()
	clanBiography?: string;

	@Property()
	clanAvatarUrl?: string;

	@Property()
	xUrl?: string | null;

	@Property()
	instagramUrl?: string | null;

	@Property()
	tiktokUrl?: string | null;

	@Property()
	isRecruiting?: boolean;

	@Property()
	autoAcceptMembers?: boolean;

	/** Réservé aux administrateurs site (cf. ClansController.updateClanInfo). */
	@Property()
	isInactive?: boolean;
}
