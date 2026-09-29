import { EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import { Entity, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { CustomBaseEntity } from "./BaseEntity";
import { Organization } from "./Organization";
import { User } from "./User";

@Entity({ repository: () => OrganizationValidationRepository })
export class OrganizationValidation extends CustomBaseEntity {
	[EntityRepositoryType]?: OrganizationValidationRepository;

	@PrimaryKey()
	id!: string;

	@ManyToOne(() => Organization, { deleteRule: "cascade" })
	organization!: Rel<Organization>;

	@ManyToOne(() => User)
	reviewer!: Rel<User>;

	@Property({ nullable: true })
	name: string | null;

	@Property({ nullable: true })
	logo: string | null;

	@Property({ nullable: true })
	description: string | null;

	@Property({ nullable: true })
	twitterUrl: string | null;

	@Property({ nullable: true })
	instagramUrl: string | null;

	@Property({ nullable: true })
	tiktokUrl: string | null;

	@Property({ nullable: true })
	twitchUrl: string | null;

	@Property({ nullable: true })
	youtubeUrl: string | null;
}

export class OrganizationValidationRepository extends EntityRepository<OrganizationValidation> {}
