import { EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import { Entity, Enum, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";
import type { DateTime } from "luxon";

import { ContractType } from "../utils/enums/contractType";
import { CustomBaseEntity } from "./BaseEntity";
import { Clan } from "./Clan";

@Entity({ repository: () => ContractRepository })
export class Contract extends CustomBaseEntity {
	[EntityRepositoryType]?: ContractRepository;

	@PrimaryKey({ autoincrement: true })
	id: number;

	@Property()
	name!: string;

	@Enum(() => ContractType)
	type!: ContractType;

	@Property()
	terminationDate!: DateTime;

	@Property()
	autoRenewal!: boolean;

	@ManyToOne(() => Clan, { primary: false, nullable: true })
	creator?: Rel<Clan>;
}

// ===========================================
// =========== Custom Repository =============
// ===========================================

export class ContractRepository extends EntityRepository<Contract> {}
