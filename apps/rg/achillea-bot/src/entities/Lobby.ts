import { randomInt } from "node:crypto";

import {
	Cascade,
	Collection,
	EntityRepository,
	EntityRepositoryType,
	type Rel,
} from "@mikro-orm/core";
import {
	Entity,
	Enum,
	Index,
	ManyToOne,
	OneToMany,
	PrimaryKey,
	Property,
} from "@mikro-orm/decorators/legacy";

import { EventTypeEnum, LobbyState, MatchFormat, MatchMode, TeamSide } from "../utils/enums";
import { CustomBaseEntity } from "./BaseEntity";
import { Event } from "./Event";
import { LobbyMatch } from "./LobbyMatch";
import { TournamentPhase } from "./TournamentPhase";
import { LobbyUser } from "./LobbyUser";

@Entity({ repository: () => LobbyRepository })
export class Lobby extends CustomBaseEntity {
	[EntityRepositoryType]?: LobbyRepository;

	@PrimaryKey()
	id!: number;

	@Enum(() => EventTypeEnum)
	eventType!: EventTypeEnum; // useful for filtering and indexing

	@ManyToOne(() => Event)
	event!: Rel<Event>;

	@Enum(() => MatchMode)
	mode: MatchMode = MatchMode.ONE_VS_ONE; // Default match mode is SINGLE

	@Enum(() => LobbyState)
	state: LobbyState = LobbyState.FRESH; // Default state is ONGOING

	@Index({
		expression:
			"CREATE INDEX lobby_bracket_match_idx ON lobby (bracket_match_id) WHERE bracket_match_id IS NOT NULL",
	})
	@Property({ nullable: true, unique: true })
	bracketMatchId?: number | null;

	@Property({ nullable: true })
	channelId?: string;

	@OneToMany(() => LobbyUser, (lu) => lu.lobby, { cascade: [Cascade.PERSIST, Cascade.REMOVE] })
	lobbyUsers = new Collection<LobbyUser>(this);

	@OneToMany(() => LobbyMatch, (lm) => lm.lobby, { cascade: [Cascade.PERSIST, Cascade.REMOVE] })
	lobbyMatches = new Collection<LobbyMatch>(this);

	@ManyToOne(() => LobbyUser, { nullable: true })
	hostUser?: Rel<LobbyUser>;

	@Property({ default: false })
	isRepool: boolean = false;

	@ManyToOne(() => TournamentPhase, { nullable: true, deleteRule: "set null" })
	phase?: Rel<TournamentPhase> | null;

	@Property({ nullable: true })
	swissRound?: number | null;

	@Enum(() => MatchFormat)
	matchFormat: MatchFormat = MatchFormat.DOUBLE_LEG;

	@Property({ nullable: true })
	customFormatChildCount?: number | null;

	/**
	 * True une fois l'Elo ranked (user_elo) appliqué pour ce lobby tournoi.
	 * Idempotence going-forward + script rétroactif.
	 */
	@Property({ default: false })
	rankedEloApplied: boolean = false;

	isFull(): boolean {
		return this.lobbyUsers.count() === this.mode;
	}

	getTeams(): [LobbyUser[], LobbyUser[]] {
		const users = this.lobbyUsers.getItems();

		return [
			users.filter((u) => u.team === TeamSide.TEAM_1),
			users.filter((u) => u.team === TeamSide.TEAM_2),
		];
	}

	getUserSide(userId: string): TeamSide | null {
		const user = this.lobbyUsers.getItems().find((lu) => lu.user.id === userId);

		return user ? user.team : null;
	}

	getTeamScore(team: TeamSide): number {
		return this.lobbyUsers.getItems().find((u) => u.team === team)?.score ?? 0;
	}

	getScoreline(): string {
		const [a, b] = this.getTeams();

		return `${a.at(0)?.score}–${b.at(0)?.score}`;
	}

	getRandomPlayer(): LobbyUser | undefined {
		const players = this.lobbyUsers.getItems();
		if (players.length === 0) return undefined;
		const idx = randomInt(0, players.length);

		return players[idx];
	}
}

export class LobbyRepository extends EntityRepository<Lobby> {}
