import { Exclude, Expose } from "class-transformer";

import type { User } from "@/entities";

import type { ClanState } from "../../../utils/enums";

@Exclude()
export class ClanDTO {
	// Clan entity
	@Expose() id!: number;
	@Expose() founders!: string;
	@Expose() name!: string;
	@Expose() shortenedName!: string;
	@Expose() normalizedShortName!: string;
	@Expose() clanAvatarUrl!: string;
	@Expose() clanBiography!: string;
	@Expose() fame!: number;
	@Expose() xUrl?: string | null;
	@Expose() instagramUrl?: string | null;
	@Expose() tiktokUrl?: string | null;
	@Expose() isRecruiting!: boolean;
	@Expose() isInactive!: boolean;
	@Expose() isHidden!: boolean;
	@Expose() isDisbanded!: boolean;
	@Expose() autoAcceptMembers!: boolean;
	@Expose() state!: ClanState;
	@Expose() createdAt!: Date;
	@Expose() languages!: string[];
	@Expose() origin!: string;

	// Extra or computed data
	@Expose() experience!: { currentLevel: number; totalXp: number };
	@Expose() membersCount!: number;
	@Expose() president!: User;
}
