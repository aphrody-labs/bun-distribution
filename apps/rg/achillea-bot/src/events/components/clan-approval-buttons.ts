import { BaseMessageOptions, ButtonInteraction, roleMention, userMention } from "discord.js";
import { Client } from "@aphrody/discordx";

import { coreManagerConfig } from "@/configs";
import { ButtonComponent, Discord, Guard, Injectable } from "@/decorators";
import { ClanMember } from "@/entities";
import { ClanApprove, RequireBotRole } from "@/guards";
import { CustomImagesUpload, Database, Logger } from "@/services";
import {
	buildErrorEmbed,
	buildNewClanEmbed,
	buildSuccessEmbed,
	deleteClan,
	followUpWithSuccessEmbed,
	resolveDependency,
} from "@/utils/functions";

import { ClanTeam } from "../../entities/ClanTeam";
import { ClanState, UserRole } from "../../utils/enums";
import { ClanTeamType } from "../../utils/enums/clanTeamType";
import {
	logOnAchilleaDefaultBotChannel,
	logOnAchilleaGenericClanChannel,
	logOnAchilleaSpecificClanChannel,
	logOnClanGuildChannel,
} from "../../utils/functions/messager";

@Discord()
@Injectable()
export class ClanApproveButtons {
	constructor(private db: Database) {}
}
