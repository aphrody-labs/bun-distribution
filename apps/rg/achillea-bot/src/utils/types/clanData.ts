import type { Guild } from "@/entities";

import type { SocialMedia } from "../functions/clan";

export type ClanData = {
	name: string;
	shortName: string;
	logoUrl: string;
	socialType: SocialMedia;
	socialUrl: string;
	biography: string;
	guild?: Guild;
	founders: string[];
	roleId: string;
	emojiId: string;
};
