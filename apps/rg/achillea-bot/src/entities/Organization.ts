import { Collection, EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import {
	Entity,
	Enum,
	ManyToOne,
	OneToMany,
	PrimaryKey,
	Property,
} from "@mikro-orm/decorators/legacy";

import { OrganizationState } from "../utils/enums/organizationState";
import { CustomBaseEntity } from "./BaseEntity";
import { User } from "./User";
import { OrganizationManager } from "./OrganizationManager";

@Entity({ repository: () => OrganizationRepository })
export class Organization extends CustomBaseEntity {
	[EntityRepositoryType]?: OrganizationRepository;

	@PrimaryKey({ autoincrement: true })
	id!: number;

	@Property()
	name!: string;

	@Property()
	normalizedName!: string;

	@Property()
	logo!: string;

	@Property()
	description!: string;

	@ManyToOne(() => User)
	owner!: Rel<User>;

	@Enum(() => OrganizationState)
	state: OrganizationState = OrganizationState.Pending;

	@Property({ default: false })
	preapproved: boolean = false;

	@Property({ nullable: true })
	preapprovedAt!: Date;

	@ManyToOne(() => User, { nullable: true })
	preapprovedBy!: Rel<User>;

	@Property({ nullable: true })
	twitterUrl: string;

	@Property({ nullable: true })
	instagramUrl: string;

	@Property({ nullable: true })
	tiktokUrl: string;

	@Property({ nullable: true })
	twitchUrl: string;

	@Property({ nullable: true })
	youtubeUrl: string;

	@Property()
	origin!: string;

	@OneToMany(() => OrganizationManager, (manager) => manager.organization)
	managers = new Collection<OrganizationManager>(this);
}

export class OrganizationRepository extends EntityRepository<Organization> {
	async getAllOrganizations(
		page?: number,
		pagination?: number,
		state: OrganizationState = OrganizationState.Approved
	): Promise<[Organization[], number]> {
		const options: any = {
			orderBy: { createdAt: "asc" },
		};

		if (pagination && page) {
			options.limit = pagination;
			options.offset = pagination * (page - 1);
		}

		return this.findAndCount({ state }, options);
	}
}
