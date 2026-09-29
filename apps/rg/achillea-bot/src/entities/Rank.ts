import { EntityRepository, EntityRepositoryType } from "@mikro-orm/core";
import { Entity, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

@Entity({ repository: () => RankRepository })
export class Rank {
	[EntityRepositoryType]?: RankRepository;

	@PrimaryKey()
	id!: number;

	@Property()
	key!: string;

	@Property()
	minElo!: number;

	@Property()
	maxElo!: number;

	@Property()
	emojiId!: string;

	@Property({ default: "" })
	emojiKey!: string;

	@Property({ type: "string[]", default: [] })
	gradient: string[];
}

export class RankRepository extends EntityRepository<Rank> {}
