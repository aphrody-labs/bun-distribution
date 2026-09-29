import { Collection, EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import { Entity, ManyToOne, OneToMany, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { CustomBaseEntity } from "./BaseEntity";
import { Organization } from "./Organization";
import { Tournament } from "./Tournament";

@Entity({ repository: () => TournamentSeriesRepository })
export class TournamentSeries extends CustomBaseEntity {
	[EntityRepositoryType]?: TournamentSeriesRepository;

	@PrimaryKey()
	id!: number;

	@Property()
	name!: string;

	@Property({ length: 1500 })
	description!: string;

	@Property()
	logo: string;

	@ManyToOne(() => Organization)
	organization!: Rel<Organization>;

	@OneToMany(() => Tournament, (t) => t.series)
	tournaments = new Collection<Tournament>(this);
}

export class TournamentSeriesRepository extends EntityRepository<TournamentSeries> {}
