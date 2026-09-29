import {
	Cascade,
	Collection,
	EntityRepository,
	EntityRepositoryType,
	type Rel,
} from "@mikro-orm/core";
import { Entity, ManyToOne, OneToMany, Property } from "@mikro-orm/decorators/legacy";

import { EventTypeEnum, InterclanState, LobbyState, MatchMode, TeamSide } from "../utils/enums";
import { Clan } from "./Clan";
import { Event } from "./Event";
import { InterclanLineup } from "./InterclanLineup";
import type { InterclanLineupMember } from "./InterclanLineupMember";
import { Lobby } from "./Lobby";
import { LobbyUser } from "./LobbyUser";

@Entity({ repository: () => InterclanRepository, discriminatorValue: EventTypeEnum.INTERCLAN })
export class Interclan extends Event {
	[EntityRepositoryType]?: InterclanRepository;

	@ManyToOne(() => Clan)
	clanA!: Rel<Clan>;

	@ManyToOne(() => Clan)
	clanB!: Rel<Clan>;

	@OneToMany(() => InterclanLineup, (l) => l.event, { cascade: [Cascade.REMOVE] })
	lineups = new Collection<InterclanLineup>(this);

	@Property({ nullable: true })
	winnerClanId?: number | null; // store ID of winner if known

	@OneToMany(() => Lobby, (l) => l.event, { orphanRemoval: true })
	lobbies = new Collection<Lobby>(this);

	@Property()
	state: InterclanState = InterclanState.PENDING_APPROVAL;

	@Property()
	fixedDate: Date = new Date();

	@Property({ nullable: true })
	discordChannelId?: string | null;

	constructor(name: string, desc: string, clanA: Clan, clanB: Clan, date: Date) {
		super();
		this.name = name;
		this.description = desc;
		this.type = EventTypeEnum.INTERCLAN;
		this.clanA = clanA;
		this.clanB = clanB;
		this.fixedDate = date;
	}

	/**
	 * Determines if both lineups are ready.
	 * Each must have between 3 and 10 members.
	 */
	isReady(): boolean {
		const lineupA = this.lineups.find((l) => l.clan.id === this.clanA.id);
		const lineupB = this.lineups.find((l) => l.clan.id === this.clanB.id);
		if (!lineupA || !lineupB) return false;

		return (
			lineupA.isValidLineup() && lineupA.lockedIn && lineupB.isValidLineup() && lineupB.lockedIn
		);
	}

	/**
	 * Returns the winning clan if set, or null if draw/unknown.
	 */
	getWinner(): Clan | null {
		return this.winnerClanId
			? this.winnerClanId === this.clanA.id
				? this.clanA
				: this.clanB
			: null;
	}

	getLineupA() {
		return this.lineups.find((l) => l.clan.id === this.clanA.id);
	}

	getLineupB() {
		return this.lineups.find((l) => l.clan.id === this.clanB.id);
	}

	canLockIn(): boolean {
		const now = new Date();
		const oneHourBefore = new Date(this.fixedDate.getTime() - 60 * 60 * 1000);

		// We’re within the hour before the event, but not after it starts
		return now >= oneHourBefore && now <= this.fixedDate;
	}

	canBeStarted(): boolean {
		const now = new Date();
		const fourHoursAfter = new Date(this.fixedDate.getTime() + 4 * 60 * 60 * 1000);

		// ✅ True if the event is ongoing window (between start and +4h)
		return now >= this.fixedDate && now <= fourHoursAfter;
	}

	areAllMatchesFinished(): boolean {
		if (!this.lobbies.isInitialized()) {
			throw new Error("Interclan.lobbies must be populated before calling areAllMatchesFinished()");
		}

		const lobbies = this.lobbies.getItems();
		if (lobbies.length === 0) return false;

		return lobbies.every((l) => l.state === LobbyState.FINISHED);
	}
}

export class InterclanRepository extends EntityRepository<Interclan> {
	/**
	 * Creates randomized 1v1 lobbies for an interclan event.
	 * Each clan’s lineup must have the same number of players.
	 */
	async generateInterclanLobbies(interclan: Interclan) {
		return await this.em.transactional(async (tem) => {
			// 1️⃣ Fully populate the interclan and its lineups
			await tem.populate(interclan, ["clanA", "clanB", "lineups.members.user"]);

			const lineupA = interclan.lineups.find((l) => l.clan.id === interclan.clanA.id);
			const lineupB = interclan.lineups.find((l) => l.clan.id === interclan.clanB.id);

			if (!interclan.isReady()) {
				throw new Error("Les 2 lineups doivent être valides avant de commencer les pairings.");
			}

			// 2️⃣ Sort players by position (pos.1 vs pos.1, etc.)
			const sortedA = lineupA!.members.getItems().toSorted((a, b) => a.position - b.position);
			const sortedB = lineupB!.members.getItems().toSorted((a, b) => a.position - b.position);

			const matchCount = Math.min(sortedA.length, sortedB.length);
			if (matchCount === 0) {
				throw new Error("Impossible de générer des matchs : aucune lineup valide trouvée.");
			}

			// 3️⃣ Create 1 lobby per corresponding pair
			const lobbies: Lobby[] = [];
			for (let i = 0; i < matchCount; i++) {
				const playerA = sortedA[i];
				const playerB = sortedB[i];

				const lobby = new Lobby();
				lobby.event = interclan;
				lobby.eventType = EventTypeEnum.INTERCLAN;
				lobby.mode = MatchMode.ONE_VS_ONE;
				lobby.state = LobbyState.FRESH;

				const userA = new LobbyUser();
				userA.user = playerA.user;
				userA.lobby = lobby;
				userA.team = TeamSide.TEAM_1;

				const userB = new LobbyUser();
				userB.user = playerB.user;
				userB.lobby = lobby;
				userB.team = TeamSide.TEAM_2;

				lobby.lobbyUsers.add(userA, userB);
				lobbies.push(lobby);
			}

			// 4️⃣ Attach and persist
			for (const lobby of lobbies) interclan.lobbies.add(lobby);

			await tem.persist(interclan).flush();

			return lobbies;
		});
	}

	computeInterclanResult(interclan: Interclan) {
		let scoreA = 0;
		let scoreB = 0;

		for (const lobby of interclan.lobbies.getItems()) {
			const [team1, team2] = lobby.getTeams();
			const s1 = team1[0]?.score ?? 0;
			const s2 = team2[0]?.score ?? 0;

			if (s1 > s2) scoreA++;
			else if (s2 > s1) scoreB++;
		}

		// In a 5v5 format, ties should not happen — add a safety guard
		if (scoreA === scoreB) {
			throw new Error(
				`Unexpected tie in Interclan ${interclan.id} — one result must break the tie.`
			);
		}

		interclan.winnerClanId = scoreA > scoreB ? interclan.clanA.id : interclan.clanB.id;

		return { scoreA, scoreB, winner: interclan.getWinner() };
	}

	async ensureLineups(interclan: Interclan) {
		// ✅ Make sure we have all required relations loaded
		await this.em.populate(interclan, ["clanA", "clanB", "lineups.clan", "lineups.members"]);

		const clans = [interclan.clanA, interclan.clanB];

		for (const clan of clans) {
			// Check if a lineup already exists for this clan
			const existing = interclan.lineups.getItems().find((l) => l.clan.id === clan.id);

			if (!existing) {
				// 🆕 Create a fresh lineup
				const lineup = new InterclanLineup();
				lineup.event = interclan;
				lineup.clan = clan;

				// Initialize empty members collection
				lineup.members = new Collection<InterclanLineupMember>(lineup);

				interclan.lineups.add(lineup);
				this.em.persist(lineup);
			}
		}

		await this.em.flush();
	}
}
