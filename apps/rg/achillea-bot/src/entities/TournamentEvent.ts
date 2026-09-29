import { EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { TournamentEventType } from "@/utils/enums";

import { Tournament } from "./Tournament";
import { User } from "./User";

/**
 * Journal métier d'un tournoi — inscriptions, retraits, disqualifications, scores,
 * changements d'état.
 *
 * Volontairement distinct d'`audit_log` : ce dernier est un journal ops signé en chaîne
 * (SHA256 chaînés), qui porte l'IP de l'acteur et des charges utiles arbitraires — le
 * publier sur une page tournoi obligerait à filtrer champ par champ à chaque lecture.
 * Ici, rien n'est écrit qui ne puisse être lu par un joueur, à l'exception de `reason`
 * (motif de DQ), masqué hors organisateurs par le contrôleur.
 */
@Entity({ tableName: "tournament_event", repository: () => TournamentEventRepository })
@Index({ properties: ["tournament", "createdAt"] })
export class TournamentEvent {
	[EntityRepositoryType]?: TournamentEventRepository;

	@PrimaryKey({ type: "uuid", defaultRaw: "gen_random_uuid()" })
	id!: string;

	@ManyToOne(() => Tournament, { deleteRule: "cascade" })
	tournament!: Rel<Tournament>;

	@Enum(() => TournamentEventType)
	type!: TournamentEventType;

	/** Auteur de l'action — null quand elle est automatique (cron, propagation bracket). */
	@ManyToOne(() => User, { nullable: true, deleteRule: "set null" })
	actor?: Rel<User> | null;

	/** Joueur concerné, quand l'évènement en vise un (inscription, DQ, promotion…). */
	@ManyToOne(() => User, { nullable: true, deleteRule: "set null" })
	target?: Rel<User> | null;

	/** Détail affichable (scores, ancien/nouvel état, seeds) — jamais de donnée sensible. */
	@Property({ type: "jsonb", nullable: true })
	payload?: Record<string, unknown> | null;

	/** Motif saisi par l'organisateur (DQ, annulation). Réservé aux organisateurs. */
	@Property({ nullable: true, length: 500 })
	reason?: string | null;

	@Property()
	createdAt: Date = new Date();
}

export class TournamentEventRepository extends EntityRepository<TournamentEvent> {
	/** Journal du plus récent au plus ancien, acteurs et cibles résolus. */
	async findForTournament(tournamentId: number, limit = 200): Promise<TournamentEvent[]> {
		return this.find(
			{ tournament: tournamentId },
			{ populate: ["actor", "target"], orderBy: { createdAt: "DESC" }, limit }
		);
	}
}
