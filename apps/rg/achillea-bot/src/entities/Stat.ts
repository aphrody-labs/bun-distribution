import { EntityRepository, EntityRepositoryType } from "@mikro-orm/core";
import { Entity, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

// ===========================================
// ================= Entity ==================
// ===========================================

@Entity({ repository: () => StatRepository })
export class Stat {
	[EntityRepositoryType]?: StatRepository;

	@PrimaryKey()
	id: number;

	@Property()
	type!: string;

	@Property()
	value: string = "";

	@Property({ type: "json", nullable: true })
	additionalData?: any;

	@Property()
	createdAt: Date = new Date();
}

// ===========================================
// =========== Custom Repository =============
// ===========================================

export class StatRepository extends EntityRepository<Stat> {}
