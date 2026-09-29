import {
	Cascade,
	Collection,
	EntityRepository,
	EntityRepositoryType,
	rel,
	type Rel,
} from "@mikro-orm/core";
import {
	Entity,
	Enum,
	OneToMany,
	OneToOne,
	PrimaryKey,
	Property,
} from "@mikro-orm/decorators/legacy";

import { ClanMemberRole, ClanState } from "../utils/enums";
import { normalizeNames, SocialMedia } from "../utils/functions/clan";
import { CustomBaseEntity } from "./BaseEntity";
import { ClanExperience } from "./ClanExperience";
import { ClanMember } from "./ClanMember";
import { Guild } from "./Guild";
import { User } from "./User";

@Entity({ repository: () => ClanRepository })
export class Clan extends CustomBaseEntity {
	[EntityRepositoryType]?: ClanRepository;

	@PrimaryKey({ autoincrement: true })
	id: number;

	@Property({ type: "string[]" })
	founders!: string[];

	@Property({ unique: true })
	name!: string;

	@Property({ unique: true })
	roleId!: string;

	@Property({ unique: true })
	shortenedName!: string;

	@Property({ unique: true })
	clanAvatarUrl!: string;

	@Property({ length: 1500 })
	clanBiography!: string;

	@Property({ nullable: true, type: "string" })
	xUrl: string | null;

	@Property({ nullable: true, type: "string" })
	instagramUrl: string | null;

	@Property({ nullable: true, type: "string" })
	tiktokUrl: string | null;

	@Property({ default: 0 })
	clanFame: number = 0;

	@OneToOne(() => Guild, { nullable: true })
	guild?: Rel<Guild> | null;

	@Property({ default: false })
	isRecruiting: boolean = false;

	@Property({ default: false })
	isInactive: boolean = false;

	@Property({ default: false })
	isHidden: boolean = false;

	@Property({ default: false })
	isDisbanded: boolean = false;

	@Property({ default: false })
	autoAcceptMembers: boolean = false;

	@Enum(() => ClanState)
	state: ClanState;

	@Property({ type: "string" })
	channelId!: string;

	@Property({ default: "" })
	normalizedShortName: string;

	@Property({ default: "" })
	clanEmojiId: string;

	@Property({ type: "string[]", default: [] })
	languages: string[];

	@Property({ default: "" })
	origin: string;

	@OneToMany(() => ClanMember, (cm) => cm.clan, { cascade: [Cascade.PERSIST, Cascade.REMOVE] })
	members = new Collection<ClanMember>(this);

	@OneToOne(() => ClanExperience, (xp) => xp.clan, { orphanRemoval: true })
	xp: Rel<ClanExperience>;

	@Property({ persist: false })
	sim: number;

	@Property({ type: "boolean", default: false })
	underMemberLimit = false;

	@Property({ default: "" })
	normalizedName!: string;

	constructor(
		foundersIds: string[],
		clanName: string,
		shortedName: string,
		avatarUrl: string,
		biography: string,
		social: SocialMedia,
		socialUrl: string,
		channelId: string,
		roleId: string,
		guildId?: string,
		state: ClanState = ClanState.Creating
	) {
		super();
		this.founders = foundersIds;
		this.name = clanName;
		this.shortenedName = shortedName;
		this.normalizedShortName = normalizeNames(shortedName);
		this.normalizedName = normalizeNames(clanName);
		this.clanAvatarUrl = avatarUrl;
		this.clanBiography = biography;
		if (social === SocialMedia.X) {
			this.xUrl = socialUrl;
		}
		if (social === SocialMedia.Instagram) {
			this.instagramUrl = socialUrl;
		}
		if (social === SocialMedia.TikTok) {
			this.tiktokUrl = socialUrl;
		}
		if (guildId) this.guild = rel(Guild, guildId);
		this.state = state;
		this.channelId = channelId;
		this.roleId = roleId;
	}
}

// ===========================================
// =========== Custom Repository =============
// ===========================================

export class ClanRepository extends EntityRepository<Clan> {
	async getFounders(clan: Clan): Promise<User[]> {
		return this.em.find(User, {
			id: { $in: clan.founders },
		});
	}

	async isFounder(clan: Clan, userId: string): Promise<boolean> {
		return clan.founders.includes(userId);
	}

	async getCaptain(clan: Clan): Promise<ClanMember | null> {
		return this.em.findOne(
			ClanMember,
			{ clan: clan.id, role: ClanMemberRole.Captain },
			{ populate: ["user"] }
		);
	}

	async getSubCaptains(clan: Clan): Promise<ClanMember[]> {
		return this.em.find(ClanMember, { clan: clan.id, role: ClanMemberRole.SubCaptain });
	}

	async getAllClans(
		page?: number,
		pagination?: number,
		state: ClanState = ClanState.Approved
	): Promise<[Clan[], number]> {
		const options: any = {
			orderBy: { createdAt: "asc" },
		};

		if (pagination && page) {
			options.limit = pagination;
			options.offset = pagination * (page - 1);
		}

		return this.findAndCount({ state, isDisbanded: false, isHidden: false }, options);
	}
}
