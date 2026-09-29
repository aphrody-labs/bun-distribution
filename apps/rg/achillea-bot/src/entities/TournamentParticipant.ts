import { EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { ParticipantStatus } from "@/utils/enums";

import { CustomBaseEntity } from "./BaseEntity";
import { Tournament } from "./Tournament";
import { User } from "./User";

@Entity({ repository: () => TournamentParticipantRepository })
@Index({ properties: ["tournament", "status"] })
export class TournamentParticipant extends CustomBaseEntity {
	[EntityRepositoryType]?: TournamentParticipantRepository;

	@PrimaryKey()
	id!: number;

	@ManyToOne(() => Tournament)
	tournament!: Rel<Tournament>;

	@ManyToOne(() => User)
	user!: Rel<User>;

	@Property({ nullable: true, index: true })
	bracketParticipantId?: number | null;

	@Property({ nullable: true })
	seed?: number | null;

	@Property({ default: false })
	hasCheckedIn: boolean = false;

	/**
	 * `Active` par défaut : la migration marque ainsi tous les inscrits existants,
	 * qui étaient de fait tous actifs (aucun autre statut n'existait).
	 */
	@Enum({ items: () => ParticipantStatus, default: ParticipantStatus.ACTIVE })
	status: ParticipantStatus = ParticipantStatus.ACTIVE;

	/**
	 * Horodatage d'inscription — ordre de la liste d'attente.
	 *
	 * `CustomBaseEntity.createdAt` existe déjà, mais la promotion depuis la liste
	 * d'attente doit rester déterministe même si un jour une ligne est recréée
	 * (import, correction), sans dépendre du champ technique de l'ORM.
	 */
	@Property()
	registeredAt: Date = new Date();

	@Property({ nullable: true })
	statusChangedAt?: Date | null;

	/** Motif d'une DQ / d'un retrait — visible des seuls organisateurs. */
	@Property({ nullable: true, length: 500 })
	statusReason?: string | null;

	/** Discord id de l'organisateur ayant changé le statut (null = automatique). */
	@Property({ nullable: true })
	statusActorId?: string | null;
}

export class TournamentParticipantRepository extends EntityRepository<TournamentParticipant> {
	/** Inscrits comptant dans la capacité / le bracket (ni liste d'attente ni DQ). */
	async findActive(tournamentId: number): Promise<TournamentParticipant[]> {
		return this.find(
			{ tournament: tournamentId, status: ParticipantStatus.ACTIVE },
			{ populate: ["user"], orderBy: { registeredAt: "ASC" } }
		);
	}

	async countActive(tournamentId: number): Promise<number> {
		return this.count({ tournament: tournamentId, status: ParticipantStatus.ACTIVE });
	}

	/** Liste d'attente dans l'ordre d'arrivée — le premier est le prochain promu. */
	async findWaitlist(tournamentId: number): Promise<TournamentParticipant[]> {
		return this.find(
			{ tournament: tournamentId, status: ParticipantStatus.WAITLISTED },
			{ populate: ["user"], orderBy: { registeredAt: "ASC" } }
		);
	}
}
