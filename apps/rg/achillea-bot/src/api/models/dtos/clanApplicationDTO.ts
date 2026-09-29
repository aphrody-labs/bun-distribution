import type { UserDTO } from "@/services";
import type { ClanMemberDistinction } from "@/utils/enums";

import type { ClanDTO } from "./clanDTO";

export type ClanApplicationDTO = {
	id: number;
	user: UserDTO;
	clan: ClanDTO;
	distinctions: ClanMemberDistinction[];
	createdAt: Date;
	updatedAt: Date;
};
