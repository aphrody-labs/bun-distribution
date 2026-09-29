import { EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { PlayerNoteCategory, PlayerNoteSeverity } from "@/utils/enums";

import { CustomBaseEntity } from "./BaseEntity";
import { Tournament } from "./Tournament";
import { User } from "./User";

/**
 * Note du staff sur un joueur — l'« espace dédié » demandé par les organisateurs pour
 * consigner ce qu'ils ont à dire d'un joueur pendant un tournoi, lisible des autres
 * membres du staff.
 *
 * Ce n'est **pas** une sanction (`Sanction`) : une note est une observation, sans
 * conséquence automatique, sans durée, sans appel. Les deux cohabitent — une note peut
 * justifier une sanction plus tard, l'inverse n'a pas de sens.
 *
 * Ces notes ne sont jamais exposées au joueur concerné ni au public : le contrôleur
 * réserve la lecture au staff et aux organisateurs du tournoi cité.
 */
@Entity({ tableName: "player_note", repository: () => PlayerNoteRepository })
@Index({ properties: ["target", "createdAt"] })
@Index({ properties: ["tournament"] })
export class PlayerNote extends CustomBaseEntity {
	[EntityRepositoryType]?: PlayerNoteRepository;

	@PrimaryKey({ type: "uuid", defaultRaw: "gen_random_uuid()" })
	id!: string;

	/** Joueur concerné par la note. */
	@ManyToOne(() => User, { deleteRule: "cascade" })
	target!: Rel<User>;

	/** Auteur de la note — conservé même si son compte disparaît (`set null`). */
	@ManyToOne(() => User, { nullable: true, deleteRule: "set null" })
	author?: Rel<User> | null;

	/**
	 * Tournoi où l'observation a eu lieu. Nullable : le staff doit pouvoir noter un
	 * comportement hors tournoi sans inventer un rattachement.
	 */
	@ManyToOne(() => Tournament, { nullable: true, deleteRule: "set null" })
	tournament?: Rel<Tournament> | null;

	@Enum({ items: () => PlayerNoteCategory, default: PlayerNoteCategory.OTHER })
	category: PlayerNoteCategory = PlayerNoteCategory.OTHER;

	@Enum({ items: () => PlayerNoteSeverity, default: PlayerNoteSeverity.INFO })
	severity: PlayerNoteSeverity = PlayerNoteSeverity.INFO;

	@Property({ type: "text" })
	content!: string;

	/** Traitée : le staff a statué, la note reste consultable en historique. */
	@Property({ default: false })
	resolved: boolean = false;

	@Property({ nullable: true })
	resolvedAt?: Date | null;

	@ManyToOne(() => User, { nullable: true, deleteRule: "set null" })
	resolvedBy?: Rel<User> | null;

	/**
	 * Lien du registre Drive où le signalement vient d'être consigné.
	 * Non persisté : c'est une information de retour immédiat (réponse Discord, API),
	 * pas un état — le document, lui, est retrouvé par son nom ou par `DataStore`.
	 */
	@Property({ persist: false })
	docsUrl?: string | null;
}

export class PlayerNoteRepository extends EntityRepository<PlayerNote> {
	/** Notes visant un joueur, de la plus récente à la plus ancienne. */
	async findForUser(userId: string, limit = 100): Promise<PlayerNote[]> {
		return this.find(
			{ target: userId },
			{ populate: ["author", "tournament", "resolvedBy"], orderBy: { createdAt: "DESC" }, limit }
		);
	}

	/** Notes rattachées à un tournoi — vue des organisateurs pendant l'évènement. */
	async findForTournament(tournamentId: number, limit = 200): Promise<PlayerNote[]> {
		return this.find(
			{ tournament: tournamentId },
			{
				populate: ["target", "author", "resolvedBy"],
				orderBy: { createdAt: "DESC" },
				limit,
			}
		);
	}
}
