import { EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import {
	Entity,
	Enum,
	ManyToOne,
	PrimaryKey,
	Property,
	Unique,
} from "@mikro-orm/decorators/legacy";

import { Provider } from "../utils/enums";
import { CustomBaseEntity } from "./BaseEntity";
import { User } from "./User";

@Entity({ repository: () => UserConnectionRepository })
@Unique({ properties: ["user", "provider"] })
export class UserConnection extends CustomBaseEntity {
	[EntityRepositoryType]?: UserConnectionRepository;

	@PrimaryKey()
	id!: number;

	@ManyToOne(() => User, { deleteRule: "cascade" })
	user!: Rel<User>;

	@Enum(() => Provider)
	provider!: Provider;

	@Property({ nullable: true })
	externalId?: string;

	@Property({ nullable: true })
	externalUsername?: string;

	@Property({ type: "text", nullable: true })
	accessToken?: string;

	@Property({ type: "text", nullable: true })
	refreshToken?: string;
}

export class UserConnectionRepository extends EntityRepository<UserConnection> {}
