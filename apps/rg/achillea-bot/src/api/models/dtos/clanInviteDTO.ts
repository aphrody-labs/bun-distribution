import type { UserDTO } from "@/services";
import type { ClanMemberDistinction } from "@/utils/enums";

import type { ClanDTO } from "./clanDTO";
import type { ClanMemberDTO } from "./clanMemberDTO";

export type ClanInviteDTO = {
	id: number;
	user: UserDTO;
	clan: ClanDTO;
	inviter: ClanMemberDTO;
	threadId?: string;
	distinctions: ClanMemberDistinction[];
	createdAt: Date;
	updatedAt: Date;
	lastNotifiedAt: Date;
};
