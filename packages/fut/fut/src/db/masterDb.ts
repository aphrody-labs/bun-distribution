/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Database } from "bun:sqlite";
import { MASTER_DB_SCHEMA_SQL } from "./schema.ts";
import type {
	FcIqRoleEntry,
	MasterPlayer,
	PlayerSearchFilter,
	PlaystyleEntry,
} from "./types.ts";

export class MasterDatabase {
	private db: Database;

	constructor(dbPath = ":memory:") {
		this.db = new Database(dbPath);
		this.db.exec("PRAGMA journal_mode = WAL;");
		this.db.exec("PRAGMA foreign_keys = ON;");
		this.initSchema();
	}

	private initSchema(): void {
		this.db.exec(MASTER_DB_SCHEMA_SQL);
	}

	public close(): void {
		this.db.close();
	}

	/**
	 * Insert or update a full player record with stats, playstyles, and FC IQ roles.
	 */
	public upsertPlayer(player: MasterPlayer): void {
		const s = player.stats;
		const secPos = player.secondaryPositions ? JSON.stringify(player.secondaryPositions) : null;

		const insertPlayerStmt = this.db.prepare(`
			INSERT INTO players (
				player_id, common_name, first_name, last_name, nationality_id,
				team_id, league_id, position, secondary_positions, birthdate,
				height_cm, weight_kg, preferred_foot, weak_foot, skill_moves,
				body_type, real_face_id, international_rep, accelerate_type,
				overall_rating, potential_rating, pace, shooting, passing,
				dribbling, defending, physicality, acceleration, sprint_speed,
				positioning, finishing, shot_power, long_shots, volleys,
				penalties, vision, crossing, free_kick_accuracy, short_passing,
				long_passing, curve, agility, balance, reactions, ball_control,
				dribbling_sub, composure, interceptions, heading_accuracy,
				def_awareness, standing_tackle, sliding_tackle, jumping,
				stamina, strength, aggression, gk_diving, gk_handling,
				gk_kicking, gk_reflexes, gk_speed, gk_positioning
			) VALUES (
				$id, $commonName, $firstName, $lastName, $nationalityId,
				$teamId, $leagueId, $position, $secPos, $birthdate,
				$heightCm, $weightKg, $preferredFoot, $weakFoot, $skillMoves,
				$bodyType, $realFaceId, $internationalRep, $acceleRate,
				$overallRating, $potentialRating, $pace, $shooting, $passing,
				$dribbling, $defending, $physicality, $acceleration, $sprintSpeed,
				$positioning, $finishing, $shotPower, $longShots, $volleys,
				$penalties, $vision, $crossing, $freeKickAccuracy, $shortPassing,
				$longPassing, $curve, $agility, $balance, $reactions, $ballControl,
				$dribblingSub, $composure, $interceptions, $headingAccuracy,
				$defAwareness, $standingTackle, $slidingTackle, $jumping,
				$stamina, $strength, $aggression, $gkDiving, $gkHandling,
				$gkKicking, $gkReflexes, $gkSpeed, $gkPositioning
			)
			ON CONFLICT(player_id) DO UPDATE SET
				overall_rating = excluded.overall_rating,
				potential_rating = excluded.potential_rating,
				pace = excluded.pace,
				shooting = excluded.shooting,
				passing = excluded.passing,
				dribbling = excluded.dribbling,
				defending = excluded.defending,
				physicality = excluded.physicality;
		`);

		insertPlayerStmt.run({
			$id: player.id,
			$commonName: player.commonName,
			$firstName: player.firstName,
			$lastName: player.lastName,
			$nationalityId: player.nationalityId,
			$teamId: player.teamId,
			$leagueId: player.leagueId,
			$position: player.position,
			$secPos: secPos,
			$birthdate: player.birthdate ?? null,
			$heightCm: player.heightCm,
			$weightKg: player.weightKg,
			$preferredFoot: player.preferredFoot,
			$weakFoot: player.weakFoot,
			$skillMoves: player.skillMoves,
			$bodyType: player.bodyType,
			$realFaceId: player.realFaceId ?? null,
			$internationalRep: player.internationalRep,
			$acceleRate: player.acceleRate,
			$overallRating: s.overallRating,
			$potentialRating: s.potentialRating,
			$pace: s.pace,
			$shooting: s.shooting,
			$passing: s.passing,
			$dribbling: s.dribbling,
			$defending: s.defending,
			$physicality: s.physicality,
			$acceleration: s.acceleration,
			$sprintSpeed: s.sprintSpeed,
			$positioning: s.positioning,
			$finishing: s.finishing,
			$shotPower: s.shotPower,
			$longShots: s.longShots,
			$volleys: s.volleys,
			$penalties: s.penalties,
			$vision: s.vision,
			$crossing: s.crossing,
			$freeKickAccuracy: s.freeKickAccuracy,
			$shortPassing: s.shortPassing,
			$longPassing: s.longPassing,
			$curve: s.curve,
			$agility: s.agility,
			$balance: s.balance,
			$reactions: s.reactions,
			$ballControl: s.ballControl,
			$dribblingSub: s.dribblingSub,
			$composure: s.composure,
			$interceptions: s.interceptions,
			$headingAccuracy: s.headingAccuracy,
			$defAwareness: s.defAwareness,
			$standingTackle: s.standingTackle,
			$slidingTackle: s.slidingTackle,
			$jumping: s.jumping,
			$stamina: s.stamina,
			$strength: s.strength,
			$aggression: s.aggression,
			$gkDiving: s.gkDiving ?? null,
			$gkHandling: s.gkHandling ?? null,
			$gkKicking: s.gkKicking ?? null,
			$gkReflexes: s.gkReflexes ?? null,
			$gkSpeed: s.gkSpeed ?? null,
			$gkPositioning: s.gkPositioning ?? null,
		});

		// Insert playstyles
		if (player.playstyles && player.playstyles.length > 0) {
			const insertPsStmt = this.db.prepare(`
				INSERT OR REPLACE INTO player_playstyles
				(player_id, playstyle_id, playstyle_name, category, is_plus)
				VALUES (?, ?, ?, ?, ?)
			`);
			for (const ps of player.playstyles) {
				insertPsStmt.run(player.id, ps.id, ps.name, ps.category, ps.isPlus ? 1 : 0);
			}
		}

		// Insert FC IQ Roles
		if (player.fcIqRoles && player.fcIqRoles.length > 0) {
			const insertRoleStmt = this.db.prepare(`
				INSERT OR REPLACE INTO player_fc_iq_roles
				(player_id, position, role_name, mastery_level, focus)
				VALUES (?, ?, ?, ?, ?)
			`);
			for (const r of player.fcIqRoles) {
				insertRoleStmt.run(player.id, r.position, r.roleName, r.masteryLevel, r.focus ?? null);
			}
		}
	}

	public getPlayer(playerId: number): MasterPlayer | null {
		const row = this.db.prepare("SELECT * FROM players WHERE player_id = ?").get(playerId) as any;
		if (!row) return null;

		const playstyles = this.getPlaystyles(playerId);
		const fcIqRoles = this.getFcIqRoles(playerId);

		return {
			id: row.player_id,
			commonName: row.common_name,
			firstName: row.first_name,
			lastName: row.last_name,
			nationalityId: row.nationality_id,
			teamId: row.team_id,
			leagueId: row.league_id,
			position: row.position,
			secondaryPositions: row.secondary_positions ? JSON.parse(row.secondary_positions) : [],
			birthdate: row.birthdate,
			heightCm: row.height_cm,
			weightKg: row.weight_kg,
			preferredFoot: row.preferred_foot,
			weakFoot: row.weak_foot,
			skillMoves: row.skill_moves,
			bodyType: row.body_type,
			realFaceId: row.real_face_id,
			internationalRep: row.international_rep,
			acceleRate: row.accelerate_type,
			stats: {
				overallRating: row.overall_rating,
				potentialRating: row.potential_rating,
				pace: row.pace,
				shooting: row.shooting,
				passing: row.passing,
				dribbling: row.dribbling,
				defending: row.defending,
				physicality: row.physicality,
				acceleration: row.acceleration,
				sprintSpeed: row.sprint_speed,
				positioning: row.positioning,
				finishing: row.finishing,
				shotPower: row.shot_power,
				longShots: row.long_shots,
				volleys: row.volleys,
				penalties: row.penalties,
				vision: row.vision,
				crossing: row.crossing,
				freeKickAccuracy: row.free_kick_accuracy,
				shortPassing: row.short_passing,
				longPassing: row.long_passing,
				curve: row.curve,
				agility: row.agility,
				balance: row.balance,
				reactions: row.reactions,
				ballControl: row.ball_control,
				dribblingSub: row.dribbling_sub,
				composure: row.composure,
				interceptions: row.interceptions,
				headingAccuracy: row.heading_accuracy,
				defAwareness: row.def_awareness,
				standingTackle: row.standing_tackle,
				slidingTackle: row.sliding_tackle,
				jumping: row.jumping,
				stamina: row.stamina,
				strength: row.strength,
				aggression: row.aggression,
				gkDiving: row.gk_diving,
				gkHandling: row.gk_handling,
				gkKicking: row.gk_kicking,
				gkReflexes: row.gk_reflexes,
				gkSpeed: row.gk_speed,
				gkPositioning: row.gk_positioning,
			},
			playstyles,
			fcIqRoles,
		};
	}

	public getPlaystyles(playerId: number): PlaystyleEntry[] {
		const rows = this.db.prepare(`
			SELECT playstyle_id, playstyle_name, category, is_plus
			FROM player_playstyles WHERE player_id = ?
		`).all(playerId) as any[];

		return rows.map((r) => ({
			id: r.playstyle_id,
			name: r.playstyle_name,
			category: r.category,
			isPlus: Boolean(r.is_plus),
		}));
	}

	public getFcIqRoles(playerId: number): FcIqRoleEntry[] {
		const rows = this.db.prepare(`
			SELECT position, role_name, mastery_level, focus
			FROM player_fc_iq_roles WHERE player_id = ?
		`).all(playerId) as any[];

		return rows.map((r) => ({
			position: r.position,
			roleName: r.role_name,
			masteryLevel: r.mastery_level,
			focus: r.focus,
		}));
	}

	public searchPlayers(filter: PlayerSearchFilter): MasterPlayer[] {
		const conditions: string[] = [];
		const params: any = {};

		if (filter.name) {
			conditions.push("(common_name LIKE $name OR last_name LIKE $name)");
			params.$name = `%${filter.name}%`;
		}
		if (filter.minOvr !== undefined) {
			conditions.push("overall_rating >= $minOvr");
			params.$minOvr = filter.minOvr;
		}
		if (filter.maxOvr !== undefined) {
			conditions.push("overall_rating <= $maxOvr");
			params.$maxOvr = filter.maxOvr;
		}
		if (filter.position) {
			conditions.push("position = $pos");
			params.$pos = filter.position;
		}
		if (filter.leagueId !== undefined) {
			conditions.push("league_id = $leagueId");
			params.$leagueId = filter.leagueId;
		}
		if (filter.nationalityId !== undefined) {
			conditions.push("nationality_id = $nationId");
			params.$nationId = filter.nationalityId;
		}
		if (filter.minPace !== undefined) {
			conditions.push("pace >= $minPace");
			params.$minPace = filter.minPace;
		}
		if (filter.acceleRate) {
			conditions.push("accelerate_type = $acceleRate");
			params.$acceleRate = filter.acceleRate;
		}

		let query = "SELECT player_id FROM players";
		if (conditions.length > 0) {
			query += ` WHERE ${conditions.join(" AND ")}`;
		}
		query += " ORDER BY overall_rating DESC";

		const limit = filter.limit ?? 50;
		const offset = filter.offset ?? 0;
		query += ` LIMIT ${limit} OFFSET ${offset}`;

		const rows = this.db.prepare(query).all(params) as Array<{ player_id: number }>;
		return rows.map((r) => this.getPlayer(r.player_id)!).filter(Boolean);
	}

	public countPlayers(): number {
		const res = this.db.prepare("SELECT COUNT(*) as count FROM players").get() as { count: number };
		return res.count;
	}

	public seedMasterDatabase(players: MasterPlayer[]): void {
		const tx = this.db.transaction(() => {
			for (const p of players) {
				this.upsertPlayer(p);
			}
		});
		tx();
	}
}
