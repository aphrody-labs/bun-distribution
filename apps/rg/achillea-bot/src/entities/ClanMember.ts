import {
	Collection,
	EntityRepository,
	EntityRepositoryType,
	PrimaryKeyProp,
	rel,
	type EventArgs,
	type Rel,
} from "@mikro-orm/core";
import {
	BeforeCreate,
	BeforeUpdate,
	Entity,
	Enum,
	ManyToOne,
	OneToMany,
	Property,
} from "@mikro-orm/decorators/legacy";

import { ClanMemberDistinction, ClanMemberRole } from "../utils/enums";
import { CustomBaseEntity } from "./BaseEntity";
import { Clan } from "./Clan";
import { ClanApplication } from "./ClanApplication";
import { ClanTeamMember } from "./ClanTeamMember";
import { User } from "./User";

@Entity({ repository: () => ClanMemberRepository })
export class ClanMember extends CustomBaseEntity {
	[EntityRepositoryType]?: ClanMemberRepository;
	[PrimaryKeyProp]?: ["user", "clan"];

	@ManyToOne(() => Clan, { primary: true })
	clan!: Rel<Clan>;

	@ManyToOne(() => User, { primary: true })
	user!: Rel<User>;

	@Property()
	clanFameContributed: number = 0;

	@OneToMany(() => ClanTeamMember, (link) => link.member)
	teamLinks = new Collection<ClanTeamMember>(this);

	@Enum(() => ClanMemberRole)
	role: ClanMemberRole = ClanMemberRole.Trial;

	@Property({ type: "string[]", default: [] })
	distinctions: ClanMemberDistinction[] = [];

	@BeforeCreate()
	ensureStaffOnCreate() {
		if (
			[ClanMemberRole.Captain, ClanMemberRole.SubCaptain].includes(this.role) &&
			!this.distinctions.includes(ClanMemberDistinction.Staff)
		) {
			this.distinctions.push(ClanMemberDistinction.Staff);
		}
	}

	@BeforeUpdate()
	ensureStaffOnUpdate(args: EventArgs<ClanMember>) {
		const prev = args.changeSet?.originalEntity as ClanMember | undefined;
		if (!prev) return;

		const wasLeadership = [ClanMemberRole.Captain, ClanMemberRole.SubCaptain].includes(prev.role);
		const isLeadership = [ClanMemberRole.Captain, ClanMemberRole.SubCaptain].includes(this.role);

		// ✅ Promotion: add Staff if missing
		if (isLeadership && !this.distinctions.includes(ClanMemberDistinction.Staff)) {
			this.distinctions.push(ClanMemberDistinction.Staff);
		}

		// 🔻 Demotion: remove Staff only if it came from the leadership role
		if (!isLeadership && wasLeadership) {
			// Only remove it if we know it came automatically
			// (e.g. not if the user has other staff privileges)
			this.distinctions = this.distinctions.filter((d) => d !== ClanMemberDistinction.Staff);
		}
	}

	get isStaff(): boolean {
		return this.distinctions.includes(ClanMemberDistinction.Staff);
	}

	get isPlayer(): boolean {
		return this.distinctions.includes(ClanMemberDistinction.Player);
	}

	get isArtist(): boolean {
		return this.distinctions.includes(ClanMemberDistinction.Artist);
	}

	get isContentCreator(): boolean {
		return this.distinctions.includes(ClanMemberDistinction.ContentCreator);
	}

	constructor(
		clanId: number,
		userId: string,
		role?: ClanMemberRole,
		distinctions?: ClanMemberDistinction[]
	) {
		super();
		const { Clan } = require("./Clan");
		const { User } = require("./User");
		this.clan = rel(Clan, clanId) as any;
		this.user = rel(User, userId) as any;
		this.role = role || ClanMemberRole.Trial;
		this.distinctions = distinctions || [];
	}
}

// ===========================================
// =========== Custom Repository =============
// ===========================================

export class ClanMemberRepository extends EntityRepository<ClanMember> {
	async createMember(
		clanId: number,
		userId: string,
		role?: ClanMemberRole,
		distinctions?: ClanMemberDistinction[]
	): Promise<ClanMember> {
		const applications = await this.em.find(ClanApplication, { user: userId });

		await this.em.remove(applications).flush();

		return new ClanMember(clanId, userId, role, distinctions);
	}

	async countClanMembers(clanId: number): Promise<number> {
		return this.count({ clan: clanId });
	}

	async getClanCaptain(clanId: number) {
		return this.findOne({ clan: clanId, role: ClanMemberRole.Captain });
	}

	async getClanSubCaptains(clanId: number) {
		return this.find({ clan: clanId, role: ClanMemberRole.SubCaptain });
	}

	async transferOwnership(clanId: number, newCptId: string) {
		const currentCpt = await this.findOne({ clan: clanId, role: ClanMemberRole.Captain });
		const newCpt = await this.findOne({ clan: clanId, user: newCptId });

		if (currentCpt && newCpt) {
			currentCpt.role = ClanMemberRole.Member;
			newCpt.role = ClanMemberRole.Captain;

			return true;
		}

		return false;
	}

	async getAllMembers(clanId: number, page?: number, pagination?: number) {
		const options: any = {
			orderBy: { createdAt: "asc" },
			populate: ["user"],
		};

		if (pagination && page) {
			options.limit = pagination;
			options.offset = pagination * (page - 1);
		}

		return this.findAndCount(
			{
				clan: clanId,
			},
			options
		);
	}
}
