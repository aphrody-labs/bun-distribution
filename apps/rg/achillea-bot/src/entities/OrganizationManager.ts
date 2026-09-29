import { EntityRepository, EntityRepositoryType, PrimaryKeyProp, type Rel } from "@mikro-orm/core";
import { Entity, ManyToOne } from "@mikro-orm/decorators/legacy";

import { CustomBaseEntity } from "./BaseEntity";
import { Organization } from "./Organization";
import { User } from "./User";

@Entity({ repository: () => OrganizationManagerRepository })
export class OrganizationManager extends CustomBaseEntity {
	[EntityRepositoryType]?: OrganizationManagerRepository;
	[PrimaryKeyProp]?: ["user", "organization"];

	@ManyToOne(() => Organization, { primary: true })
	organization!: Rel<Organization>;

	@ManyToOne(() => User, { primary: true })
	user!: Rel<User>;
}

export class OrganizationManagerRepository extends EntityRepository<OrganizationManager> {}
