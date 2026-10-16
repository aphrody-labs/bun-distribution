import { Elysia, status, t } from "elysia";
import { dbPlugin } from "../../../plugins/db";
import { TournamentModel } from "./model";
import { TournamentService } from "./service";
import { resolveAchilleaSession } from "../../auth/session";
import type { Kysely } from "kysely";
import type { Database } from "@rosegriffon/db/schema";
import { rebuildTournamentBracket, tournamentBracketData } from "./bracket";
import { applyPlacementPrizes } from "./placement";
import { circuitRanking, circuitStats, playerCircuitProfile, tournamentSummary } from "./circuit";
import { verifyAdminBearerToken } from "@rosegriffon/achillea-core/auth";

type LobbyAccess = {
  session: { id: string };
  lobby: {
    id: number;
    state: string;
    event_id: number;
    event_type: string;
    score_report_policy: string | null;
    organization_id: number | null;
  };
  player: { team: number } | undefined;
  isOrganizer: boolean;
};

async function lobbyAccess(
  db: Kysely<Database>,
  headers: { authorization?: string; cookie?: string },
  lobbyId: number,
): Promise<LobbyAccess | { unauthenticated: true } | { notFound: true }> {
  const session = await resolveAchilleaSession(headers);
  if (!session) return { unauthenticated: true };
  const lobby = await db
    .selectFrom("lobby as l")
    .innerJoin("event as e", "e.id", "l.event_id")
    .select(["l.id", "l.state", "l.event_id", "l.event_type", "e.score_report_policy", "e.organization_id"])
    .where("l.id", "=", lobbyId)
    .executeTakeFirst();
  if (!lobby) return { notFound: true };
  const player = await db
    .selectFrom("lobby_user")
    .select("team")
    .where("lobby_id", "=", lobbyId)
    .where("user_id", "=", session.id)
    .executeTakeFirst();
  let isOrganizer = false;
  if (lobby.event_type === "TOURNAMENT" && lobby.organization_id !== null) {
    const [actor, manager, owner] = await Promise.all([
      db.selectFrom("user").select("role").where("id", "=", session.id).executeTakeFirst(),
      db
        .selectFrom("organization_manager")
        .select("organization_id")
        .where("organization_id", "=", lobby.organization_id)
        .where("user_id", "=", session.id)
        .executeTakeFirst(),
      db
        .selectFrom("organization")
        .select("owner_id")
        .where("id", "=", lobby.organization_id)
        .where("owner_id", "=", session.id)
        .executeTakeFirst(),
    ]);
    isOrganizer = Boolean((actor && actor.role >= 2) || manager || owner);
  }
  return { session, lobby, player, isOrganizer };
}

function isLobbyFinished(state: string): boolean {
  return state === "Finished" || state === "Forfeited" || state === "Canceled";
}

function canReport(access: LobbyAccess): boolean {
  return access.isOrganizer || access.lobby.score_report_policy !== "staff_only";
}

async function serializeLobby(db: Kysely<Database>, lobbyId: number, byBracket: boolean) {
  const lobby = await db
    .selectFrom("lobby")
    .selectAll()
    .where(byBracket ? "bracket_match_id" : "id", "=", lobbyId)
    .executeTakeFirst();
  if (!lobby) return null;
  const [users, matches] = await Promise.all([
    db
      .selectFrom("lobby_user as lu")
      .innerJoin("user as u", "u.id", "lu.user_id")
      .select(["lu.id", "lu.team", "lu.forfeit", "lu.state", "u.id as user_id", "u.display_name", "u.avatar"])
      .where("lu.lobby_id", "=", lobby.id)
      .orderBy("lu.team", "asc")
      .orderBy("lu.id", "asc")
      .execute(),
    db.selectFrom("lobby_match").selectAll().where("lobby_id", "=", lobby.id).orderBy("game_number", "asc").execute(),
  ]);
  const host = lobby.host_user_id === null ? null : (users.find(user => user.id === lobby.host_user_id) ?? null);
  return {
    id: Number(lobby.id),
    mode: Number(lobby.mode),
    state: lobby.state,
    bracketMatchId: lobby.bracket_match_id,
    matchFormat: lobby.match_format,
    lobbyUsers: users.map(user => ({
      id: Number(user.id),
      team: Number(user.team),
      forfeit: user.forfeit,
      state: user.state,
      user: { id: user.user_id, displayName: user.display_name, avatar: user.avatar ?? "" },
    })),
    lobbyMatches: matches.map(match => ({
      id: Number(match.id),
      gameNumber: match.game_number,
      scoreTeam1: match.score_team1,
      scoreTeam2: match.score_team2,
      team1Validated: match.team1validated,
      team2Validated: match.team2validated,
      adminValidated: match.admin_validated,
    })),
    hostUser: host
      ? {
          id: Number(host.id),
          team: Number(host.team),
          forfeit: host.forfeit,
          state: host.state,
          user: { id: host.user_id, displayName: host.display_name, avatar: host.avatar ?? "" },
        }
      : null,
  };
}

async function organizer(db: Kysely<Database>, headers: { authorization?: string; cookie?: string }, id: number) {
  const session = await resolveAchilleaSession(headers);
  if (!session) return { error: status(401, { message: "Authentication required" as const }) };
  const tournament = await db
    .selectFrom("event")
    .select(["id", "organization_id", "internal_state", "type", "tournament_type", "participants_number"])
    .where("id", "=", id)
    .where("type", "=", "TOURNAMENT")
    .executeTakeFirst();
  if (!tournament) return { error: status(404, { message: "Tournament not found" as const }) };
  const actor = await db.selectFrom("user").select("role").where("id", "=", session.id).executeTakeFirst();
  const manager =
    tournament.organization_id === null
      ? null
      : await db
          .selectFrom("organization_manager")
          .select("organization_id")
          .where("organization_id", "=", tournament.organization_id)
          .where("user_id", "=", session.id)
          .executeTakeFirst();
  const owner =
    tournament.organization_id === null
      ? null
      : await db
          .selectFrom("organization")
          .select("owner_id")
          .where("id", "=", tournament.organization_id)
          .where("owner_id", "=", session.id)
          .executeTakeFirst();
  const eventManager = await db
    .selectFrom("event_managers")
    .select("event_id")
    .where("event_id", "=", id)
    .where("user_id", "=", session.id)
    .executeTakeFirst();
  if (!actor || (actor.role < 2 && !manager && !owner && !eventManager))
    return { error: status(403, { message: "Tournament organizer required" as const }) };
  return { session, tournament };
}

async function seedingTournament(db: Kysely<Database>, id: number) {
  const tournament = await db
    .selectFrom("event")
    .select(["id", "internal_state", "participants_number", "tournament_type"])
    .where("id", "=", id)
    .where("type", "=", "TOURNAMENT")
    .executeTakeFirst();
  if (!tournament) return { error: status(404, { message: "Tournament not found" as const }) };
  if (tournament.internal_state !== "Preregistering" && tournament.internal_state !== "Preparing")
    return {
      error: status(400, {
        message: "Seeding is only editable during registration or preparation" as const,
      }),
    };
  return { tournament };
}

async function recordSeedingEvent(
  db: Kysely<Database>,
  tournamentId: number,
  actorId: string,
  payload: Record<string, unknown>,
) {
  await db
    .insertInto("tournament_event")
    .values({
      tournament_id: tournamentId,
      type: "SEEDING_CHANGED",
      actor_id: actorId,
      target_id: null,
      payload,
      reason: null,
    })
    .execute();
}

async function activeParticipants(db: Kysely<Database>, tournamentId: number) {
  return db
    .selectFrom("tournament_participant as p")
    .innerJoin("user as u", "u.id", "p.user_id")
    .select(["p.id", "p.user_id", "p.seed", "p.status", "u.display_name", "u.username"])
    .where("p.tournament_id", "=", tournamentId)
    .where("p.status", "=", "Active")
    .orderBy("p.id", "asc")
    .execute();
}

async function assignSeeds(db: Kysely<Database>, participants: Array<{ id: number }>, cap: number) {
  await db.transaction().execute(async trx => {
    await trx
      .updateTable("tournament_participant")
      .set({ seed: null, updated_at: new Date() })
      .where(
        "id",
        "in",
        participants.map(participant => participant.id),
      )
      .execute();
    for (const [index, participant] of participants.entries()) {
      await trx
        .updateTable("tournament_participant")
        .set({ seed: index < cap ? index + 1 : null, updated_at: new Date() })
        .where("id", "=", participant.id)
        .execute();
    }
  });
}

export const tournamentController = new Elysia({ prefix: "/tournaments" })
  .use(dbPlugin)
  .get("/circuit/ranking", ({ db }) => circuitRanking(db))
  .get("/circuit/stats", ({ db }) => circuitStats(db))
  .get("/circuit/players/:userId", async ({ db, params, status }) => {
    const profile = await playerCircuitProfile(db, params.userId);
    return profile ?? status(404, { message: "Player not found" as const });
  })
  .get("/:id/summary", async ({ db, params, status }) => {
    const summary = await tournamentSummary(db, Number(params.id));
    return summary ?? status(404, { message: "Tournament not found" as const });
  })
  .post(
    "/internal/schedule-transitions",
    async ({ db, headers, body, set }) => {
      const bearer = headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!verifyAdminBearerToken(bearer, process.env.API_ADMIN_TOKEN)) {
        set.status = 401;
        return { message: "Internal authentication required" as const };
      }

      const requestedNow = (body as { now?: unknown } | undefined)?.now;
      const now = requestedNow ? new Date(String(requestedNow)) : new Date();
      if (Number.isNaN(now.getTime())) {
        set.status = 400;
        return { message: "Invalid transition timestamp" as const };
      }

      const transitions: Array<{
        tournamentId: number;
        from: "Pending" | "Preregistering";
        to: "Preregistering" | "Preparing";
      }> = [];

      const openDue = await db
        .selectFrom("event")
        .select("id")
        .where("type", "=", "TOURNAMENT")
        .where("internal_state", "=", "Pending")
        .where("registration_opens_at", "is not", null)
        .where("registration_opens_at", "<=", now)
        .execute();
      for (const tournament of openDue) {
        await db.transaction().execute(async trx => {
          const current = await trx
            .selectFrom("event")
            .select("internal_state")
            .where("id", "=", tournament.id)
            .where("type", "=", "TOURNAMENT")
            .executeTakeFirst();
          if (current?.internal_state !== "Pending") return;
          await trx
            .updateTable("event")
            .set({ internal_state: "Preregistering", updated_at: now })
            .where("id", "=", tournament.id)
            .execute();
          await trx
            .insertInto("tournament_event")
            .values({
              tournament_id: tournament.id,
              type: "REGISTRATIONS_OPENED",
              actor_id: null,
              target_id: null,
              payload: { automatic: true },
              reason: null,
            })
            .execute();
          transitions.push({ tournamentId: tournament.id, from: "Pending", to: "Preregistering" });
        });
      }

      const closeDue = await db
        .selectFrom("event")
        .select(["id", "participants_number", "tournament_type"])
        .where("type", "=", "TOURNAMENT")
        .where("internal_state", "=", "Preregistering")
        .where("registration_closes_at", "is not", null)
        .where("registration_closes_at", "<=", now)
        .execute();
      for (const tournament of closeDue) {
        // Bracket construction is already Kysely-owned by this module. The
        // state transition and event are committed only after a successful
        // rebuild, keeping retries idempotent.
        const rebuilt = await rebuildTournamentBracket(db, tournament.id).catch(() => false);
        if (!rebuilt && tournament.tournament_type !== "league") continue;
        await db.transaction().execute(async trx => {
          const current = await trx
            .selectFrom("event")
            .select("internal_state")
            .where("id", "=", tournament.id)
            .where("type", "=", "TOURNAMENT")
            .executeTakeFirst();
          if (current?.internal_state !== "Preregistering") return;
          await trx
            .updateTable("event")
            .set({ internal_state: "Preparing", updated_at: now })
            .where("id", "=", tournament.id)
            .execute();
          await trx
            .insertInto("tournament_event")
            .values({
              tournament_id: tournament.id,
              type: "REGISTRATIONS_CLOSED",
              actor_id: null,
              target_id: null,
              payload: { automatic: true, bracketRebuilt: rebuilt },
              reason: null,
            })
            .execute();
          transitions.push({ tournamentId: tournament.id, from: "Preregistering", to: "Preparing" });
        });
      }
      const startCandidates = await db
        .selectFrom("event")
        .select("id")
        .where("type", "=", "TOURNAMENT")
        .where("internal_state", "=", "Preparing")
        .where("auto_start", "=", true)
        .where("starts_at", "is not", null)
        .where("starts_at", "<=", now)
        .execute();
      return { transitions, startCandidates: startCandidates.map(({ id }) => id) };
    },
    {
      body: t.Optional(t.Object({ now: t.Optional(t.String()) })),
      response: {
        200: t.Object({
          transitions: t.Array(t.Object({ tournamentId: t.Number(), from: t.String(), to: t.String() })),
          startCandidates: t.Array(t.Number()),
        }),
        400: t.Object({ message: t.Literal("Invalid transition timestamp") }),
        401: t.Object({ message: t.Literal("Internal authentication required") }),
      },
    },
  )
  .post(
    "/create/achillea",
    async ({ db, headers, body }) => {
      const session = await resolveAchilleaSession(headers);
      if (!session) return status(401, { message: "Authentication required" as const });
      const input = body as Record<string, any>;
      const organizationId =
        typeof input.organization === "number" ? input.organization : Number(input.organization?.id);
      if (!Number.isInteger(organizationId) || organizationId <= 0)
        return status(400, { message: "Organization is required" as const });
      const organization = await db
        .selectFrom("organization")
        .select(["id", "owner_id"])
        .where("id", "=", organizationId)
        .executeTakeFirst();
      if (!organization) return status(404, { message: "Organization not found" as const });
      const actor = await db.selectFrom("user").select("role").where("id", "=", session.id).executeTakeFirst();
      const manager = await db
        .selectFrom("organization_manager")
        .select("organization_id")
        .where("organization_id", "=", organizationId)
        .where("user_id", "=", session.id)
        .executeTakeFirst();
      if (!actor || (actor.role < 2 && organization.owner_id !== session.id && !manager))
        return status(403, { message: "Organization manager required" as const });
      const startsAt = new Date(input.startsAt);
      const grandFinalAt = new Date(input.grandFinalAt);
      if (
        !input.name ||
        !input.description ||
        Number.isNaN(startsAt.getTime()) ||
        Number.isNaN(grandFinalAt.getTime()) ||
        startsAt >= grandFinalAt
      )
        return status(400, { message: "Invalid tournament fields" as const });
      const row = await db
        .insertInto("event")
        .values({
          name: String(input.name),
          description: String(input.description),
          type: "TOURNAMENT",
          status: null,
          queue_ends_at: null,
          mode: null,
          clan_a_id: null,
          clan_b_id: null,
          winner_clan_id: null,
          state: 0,
          fixed_date: null,
          discord_channel_id: null,
          organization_id: organizationId,
          internal_state: "Pending",
          participants_number: Number(input.participantsNumber) || null,
          tournament_type: String(input.tournamentType ?? "single_elimination"),
          starts_at: startsAt,
          grand_final_at: grandFinalAt,
          group_stage_enabled: Boolean(input.groupStageEnabled),
          group_stage_type: input.groupStageType ?? null,
          logo: String(input.logo ?? ""),
          affiche: String(input.affiche ?? ""),
          planning: String(input.planning ?? ""),
          ruleset: String(input.ruleset ?? ""),
          seed_ordering: input.seedOrdering ?? null,
          match_format: input.matchFormat ?? null,
          custom_format_child_count: input.customFormatChildCount ?? null,
          score_report_policy: input.scoreReportPolicy ?? "players",
          registration_opens_at: input.registrationOpensAt ? new Date(input.registrationOpensAt) : null,
          registration_closes_at: input.registrationClosesAt ? new Date(input.registrationClosesAt) : null,
          auto_start: Boolean(input.autoStart),
          discord_role_enabled: Boolean(input.discordRoleEnabled),
          discord_role_id: null,
          discord_guild_id: null,
          cancel_reason: null,
          canceled_at: null,
          closed_at: null,
        } as any)
        .returningAll()
        .executeTakeFirstOrThrow();
      const managerIds = Array.isArray(input.managers)
        ? input.managers
            .map((manager: any) => (typeof manager === "string" ? manager : manager?.id))
            .filter((id: unknown): id is string => typeof id === "string")
        : [];
      if (!managerIds.includes(session.id)) managerIds.push(session.id);
      if (managerIds.length)
        await db
          .insertInto("event_managers")
          .values(
            managerIds.map(userId => ({
              event_id: row.id,
              user_id: userId,
            })) as any,
          )
          .onConflict(oc => oc.doNothing())
          .execute();
      return row;
    },
    {
      body: t.Any(),
      response: {
        200: t.Any(),
        400: t.Object({ message: t.String() }),
        401: t.Object({ message: t.Literal("Authentication required") }),
        403: t.Object({ message: t.Literal("Organization manager required") }),
        404: t.Object({ message: t.Literal("Organization not found") }),
      },
    },
  )
  .post(
    "/set-participant-seeding/:id",
    async ({ db, headers, params: { id }, body }) => {
      const auth = await organizer(db, headers, id);
      if (auth.error) return auth.error;
      const editable = await seedingTournament(db, id);
      if (editable.error) return editable.error;
      const input = (body as any)?.participant ?? body;
      const participantId = Number(input?.id);
      if (!Number.isInteger(participantId)) return status(400, { message: "Participant id is required" as const });
      const participant = await db
        .selectFrom("tournament_participant")
        .select(["id", "user_id", "seed", "status"])
        .where("id", "=", participantId)
        .where("tournament_id", "=", id)
        .executeTakeFirst();
      if (!participant) return status(404, { message: "Participant not found" as const });
      if (participant.status !== "Active") return status(400, { message: "Participant is not active" as const });
      const requested = Number(input?.seed);
      const newSeed = Number.isInteger(requested) && requested > 0 ? requested : null;
      const capacity = editable.tournament.participants_number ?? 0;
      if (newSeed !== null && (capacity <= 0 || newSeed > capacity))
        return status(400, { message: "Seed is outside tournament capacity" as const });
      let swappedWith: string | null = null;
      if (newSeed !== null) {
        const occupant = await db
          .selectFrom("tournament_participant as p")
          .innerJoin("user as u", "u.id", "p.user_id")
          .select(["p.id", "u.display_name", "u.username"])
          .where("p.tournament_id", "=", id)
          .where("p.seed", "=", newSeed)
          .where("p.id", "!=", participant.id)
          .executeTakeFirst();
        if (occupant) {
          swappedWith = occupant.display_name || occupant.username || null;
          await db
            .updateTable("tournament_participant")
            .set({ seed: participant.seed, updated_at: new Date() })
            .where("id", "=", occupant.id)
            .execute();
        }
      }
      await db
        .updateTable("tournament_participant")
        .set({ seed: newSeed, updated_at: new Date() })
        .where("id", "=", participant.id)
        .execute();
      const bracketUpdated = await rebuildTournamentBracket(db, id).catch(() => false);
      await recordSeedingEvent(db, id, auth.session.id, {
        mode: "manual",
        participantId,
        seed: newSeed,
        previousSeed: participant.seed,
        swappedWith,
      });
      return {
        participantId,
        seed: newSeed,
        previousSeed: participant.seed,
        swappedWith,
        bracketUpdated,
      };
    },
    { params: t.Object({ id: t.Integer() }), body: t.Any() },
  )
  .post(
    "/seed-by-ranked/:id",
    async ({ db, headers, params: { id } }) => {
      const auth = await organizer(db, headers, id);
      if (auth.error) return auth.error;
      const editable = await seedingTournament(db, id);
      if (editable.error) return editable.error;
      const participants = await activeParticipants(db, id);
      if (!participants.length) return status(400, { message: "No active participants" as const });
      const eloRows = await db
        .selectFrom("user_elo")
        .select(["user_id", "elo"])
        .where("mode", "=", 1)
        .where(
          "user_id",
          "in",
          participants.map(p => p.user_id),
        )
        .execute();
      const elo = new Map(eloRows.map(row => [row.user_id, Number(row.elo ?? 0)]));
      participants.sort(
        (a, b) =>
          (elo.get(b.user_id) ?? 0) - (elo.get(a.user_id) ?? 0) ||
          (a.display_name || a.username || a.user_id).localeCompare(b.display_name || b.username || b.user_id, "fr"),
      );
      await assignSeeds(db, participants, editable.tournament.participants_number ?? 0);
      const bracketUpdated = await rebuildTournamentBracket(db, id).catch(() => false);
      await recordSeedingEvent(db, id, auth.session.id, {
        mode: "ranked",
        seeded: participants.length,
      });
      return {
        mode: "ranked" as const,
        bracketUpdated,
        assignments: participants.map((p, index) => ({
          id: p.id,
          seed: index + 1,
          userId: p.user_id,
          username: p.display_name || p.username || p.user_id,
          soloElo: elo.get(p.user_id) ?? 0,
        })),
      };
    },
    { params: t.Object({ id: t.Integer() }) },
  )
  .post(
    "/seed-random/:id",
    async ({ db, headers, params: { id } }) => {
      const auth = await organizer(db, headers, id);
      if (auth.error) return auth.error;
      const editable = await seedingTournament(db, id);
      if (editable.error) return editable.error;
      const participants = await activeParticipants(db, id);
      if (!participants.length) return status(400, { message: "No active participants" as const });
      for (let index = participants.length - 1; index > 0; index--) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [participants[index], participants[randomIndex]] = [participants[randomIndex], participants[index]];
      }
      await assignSeeds(db, participants, editable.tournament.participants_number ?? 0);
      const bracketUpdated = await rebuildTournamentBracket(db, id).catch(() => false);
      await recordSeedingEvent(db, id, auth.session.id, {
        mode: "random",
        seeded: participants.length,
      });
      return {
        mode: "random" as const,
        bracketUpdated,
        assignments: participants.map((p, index) => ({
          id: p.id,
          seed: index + 1,
          userId: p.user_id,
          username: p.display_name || p.username || p.user_id,
        })),
      };
    },
    { params: t.Object({ id: t.Integer() }) },
  )
  .post(
    "/clear-seeds/:id",
    async ({ db, headers, params: { id } }) => {
      const auth = await organizer(db, headers, id);
      if (auth.error) return auth.error;
      const editable = await seedingTournament(db, id);
      if (editable.error) return editable.error;
      const participants = await db
        .selectFrom("tournament_participant")
        .select("id")
        .where("tournament_id", "=", id)
        .execute();
      if (participants.length)
        await db
          .updateTable("tournament_participant")
          .set({ seed: null, updated_at: new Date() })
          .where("tournament_id", "=", id)
          .execute();
      const bracketUpdated = await rebuildTournamentBracket(db, id).catch(() => false);
      await recordSeedingEvent(db, id, auth.session.id, {
        mode: "clear",
        cleared: participants.length,
      });
      return {
        mode: "clear" as const,
        bracketUpdated,
        cleared: participants.length,
      };
    },
    { params: t.Object({ id: t.Integer() }) },
  )
  .post(
    "/generate-bracket/:id",
    async ({ db, headers, params: { id } }) => {
      const auth = await organizer(db, headers, id);
      if (auth.error) return auth.error;
      const updated = await rebuildTournamentBracket(db, id);
      if (!updated) return status(400, { message: "Bracket cannot be generated for this tournament" as const });
      return { success: true as const, tournamentData: await tournamentBracketData(id) };
    },
    { params: t.Object({ id: t.Integer() }) },
  )
  .put(
    "/:id/edit",
    async ({ db, headers, params: { id }, body }) => {
      const auth = await organizer(db, headers, id);
      if (auth.error) return auth.error;
      const input = body as Record<string, any>;
      const patch: Record<string, unknown> = { updated_at: new Date() };
      for (const [source, target] of [
        ["name", "name"],
        ["description", "description"],
        ["logo", "logo"],
        ["affiche", "affiche"],
        ["planning", "planning"],
        ["ruleset", "ruleset"],
        ["tournamentType", "tournament_type"],
        ["participantsNumber", "participants_number"],
        ["seedOrdering", "seed_ordering"],
        ["matchFormat", "match_format"],
        ["customFormatChildCount", "custom_format_child_count"],
        ["groupStageEnabled", "group_stage_enabled"],
        ["groupStageType", "group_stage_type"],
        ["scoreReportPolicy", "score_report_policy"],
        ["registrationOpensAt", "registration_opens_at"],
        ["registrationClosesAt", "registration_closes_at"],
        ["autoStart", "auto_start"],
        ["discordRoleEnabled", "discord_role_enabled"],
      ] as const) {
        if (input[source] !== undefined)
          patch[target] = source.endsWith("At") && input[source] ? new Date(input[source]) : input[source];
      }
      return db
        .updateTable("event")
        .set(patch as any)
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirstOrThrow();
    },
    {
      params: t.Object({ id: t.Integer() }),
      body: t.Any(),
      response: {
        200: t.Any(),
        401: t.Object({ message: t.Literal("Authentication required") }),
        403: t.Object({ message: t.Literal("Tournament organizer required") }),
        404: TournamentModel.notFound,
      },
    },
  )
  .post(
    "/add-managers/:id",
    async ({ db, headers, params: { id }, body }) => {
      const auth = await organizer(db, headers, id);
      if (auth.error) return auth.error;
      const ids = (Array.isArray(body) ? body : [])
        .map((manager: any) => (typeof manager === "string" ? manager : manager?.id))
        .filter((userId: unknown): userId is string => typeof userId === "string" && userId.length > 0);
      if (ids.length)
        await db
          .insertInto("event_managers")
          .values(ids.map(userId => ({ event_id: id, user_id: userId })))
          .onConflict(oc => oc.doNothing())
          .execute();
      return { success: true as const, added: ids.length };
    },
    {
      params: t.Object({ id: t.Integer() }),
      body: t.Array(t.Any()),
      response: {
        200: t.Object({ success: t.Literal(true), added: t.Number() }),
        401: t.Object({ message: t.Literal("Authentication required") }),
        403: t.Object({ message: t.Literal("Tournament organizer required") }),
        404: TournamentModel.notFound,
      },
    },
  )
  .post(
    "/remove-manager/:id",
    async ({ db, headers, params: { id }, body }) => {
      const auth = await organizer(db, headers, id);
      if (auth.error) return auth.error;
      const userId = typeof body === "string" ? body : (body as any)?.id;
      if (typeof userId !== "string" || !userId) return status(400, { message: "Manager id is required" as const });
      await db.deleteFrom("event_managers").where("event_id", "=", id).where("user_id", "=", userId).execute();
      return { success: true as const, removed: userId };
    },
    {
      params: t.Object({ id: t.Integer() }),
      body: t.Any(),
      response: {
        200: t.Object({ success: t.Literal(true), removed: t.String() }),
        400: t.Object({ message: t.Literal("Manager id is required") }),
        401: t.Object({ message: t.Literal("Authentication required") }),
        403: t.Object({ message: t.Literal("Tournament organizer required") }),
        404: TournamentModel.notFound,
      },
    },
  )
  .post(
    "/open-registrations/:id",
    async ({ db, headers, params: { id } }) => {
      const auth = await organizer(db, headers, id);
      if (auth.error) return auth.error;
      if (auth.tournament.internal_state !== "Pending")
        return status(400, { message: "Tournament is not pending" as const });
      await db.updateTable("event").set({ internal_state: "Preregistering" }).where("id", "=", id).execute();
      await db
        .insertInto("tournament_event")
        .values({
          tournament_id: id,
          type: "REGISTRATIONS_OPENED",
          actor_id: auth.session.id,
          target_id: null,
          payload: null,
          reason: null,
        })
        .execute();
      return { success: true as const, id, internalState: "Preregistering" as const };
    },
    {
      params: t.Object({ id: t.Numeric() }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          id: t.Number(),
          internalState: t.Literal("Preregistering"),
        }),
        400: t.Object({ message: t.String() }),
        401: t.Object({ message: t.Literal("Authentication required") }),
        403: t.Object({ message: t.Literal("Tournament organizer required") }),
        404: TournamentModel.notFound,
      },
    },
  )
  .post(
    "/:id/close",
    async ({ db, headers, params: { id }, body }) => {
      const auth = await organizer(db, headers, id);
      if (auth.error) return auth.error;
      if (auth.tournament.internal_state !== "Ongoing")
        return status(400, { message: "Only an ongoing tournament can be closed" as const });
      await db
        .updateTable("event")
        .set({ internal_state: "Finished", closed_at: new Date() })
        .where("id", "=", id)
        .execute();
      await db
        .insertInto("tournament_event")
        .values({
          tournament_id: id,
          type: "TOURNAMENT_CLOSED",
          actor_id: auth.session.id,
          target_id: null,
          payload: { forced: body.force === true },
          reason: null,
        })
        .execute();
      return {
        success: true as const,
        openLobbies: 0,
        forced: body.force === true,
        placementPrizes: null,
      };
    },
    {
      params: t.Object({ id: t.Numeric() }),
      body: t.Object({ force: t.Optional(t.Boolean()) }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          openLobbies: t.Number(),
          forced: t.Boolean(),
          placementPrizes: t.Nullable(t.Unknown()),
        }),
        400: t.Object({ message: t.String() }),
        401: t.Object({ message: t.Literal("Authentication required") }),
        403: t.Object({ message: t.Literal("Tournament organizer required") }),
        404: TournamentModel.notFound,
      },
    },
  )
  .post(
    "/:id/cancel",
    async ({ db, headers, params: { id }, body }) => {
      const auth = await organizer(db, headers, id);
      if (auth.error) return auth.error;
      const reason = body.reason.trim();
      if (reason.length < 3) return status(400, { message: "Cancellation reason is required" as const });
      if (auth.tournament.internal_state === "Finished")
        return status(400, { message: "Finished tournament cannot be canceled" as const });
      if (auth.tournament.internal_state === "Canceled")
        return status(409, { message: "Tournament is already canceled" as const });
      await db
        .updateTable("event")
        .set({
          internal_state: "Canceled",
          cancel_reason: reason.slice(0, 500),
          canceled_at: new Date(),
        })
        .where("id", "=", id)
        .execute();
      await db
        .insertInto("tournament_event")
        .values({
          tournament_id: id,
          type: "TOURNAMENT_CANCELED",
          actor_id: auth.session.id,
          target_id: null,
          payload: { previousState: auth.tournament.internal_state },
          reason,
        })
        .execute();
      return { success: true as const, notified: 0 };
    },
    {
      params: t.Object({ id: t.Numeric() }),
      body: t.Object({ reason: t.String() }),
      response: {
        200: t.Object({ success: t.Literal(true), notified: t.Number() }),
        400: t.Object({ message: t.String() }),
        401: t.Object({ message: t.Literal("Authentication required") }),
        403: t.Object({ message: t.Literal("Tournament organizer required") }),
        404: TournamentModel.notFound,
        409: t.Object({ message: t.String() }),
      },
    },
  )
  .post(
    "/:id/restore",
    async ({ db, headers, params: { id } }) => {
      const auth = await organizer(db, headers, id);
      if (auth.error) return auth.error;
      if (auth.tournament.internal_state !== "Canceled")
        return status(400, { message: "Tournament is not canceled" as const });
      const previous = await db
        .selectFrom("tournament_event")
        .select("payload")
        .where("tournament_id", "=", id)
        .where("type", "=", "TOURNAMENT_CANCELED")
        .orderBy("created_at", "desc")
        .executeTakeFirst();
      const previousState = (previous?.payload as { previousState?: string } | null)?.previousState;
      const restored = ["Pending", "Preregistering", "Preparing", "Ongoing"].includes(previousState ?? "")
        ? (previousState as "Pending" | "Preregistering" | "Preparing" | "Ongoing")
        : "Pending";
      await db
        .updateTable("event")
        .set({ internal_state: restored, cancel_reason: null, canceled_at: null })
        .where("id", "=", id)
        .execute();
      await db
        .insertInto("tournament_event")
        .values({
          tournament_id: id,
          type: "TOURNAMENT_RESTORED",
          actor_id: auth.session.id,
          target_id: null,
          payload: { restoredState: restored },
          reason: null,
        })
        .execute();
      return { success: true as const, internalState: restored };
    },
    {
      params: t.Object({ id: t.Numeric() }),
      response: {
        200: t.Object({ success: t.Literal(true), internalState: t.String() }),
        400: t.Object({ message: t.String() }),
        401: t.Object({ message: t.Literal("Authentication required") }),
        403: t.Object({ message: t.Literal("Tournament organizer required") }),
        404: TournamentModel.notFound,
      },
    },
  )
  .put(
    "/start/:id",
    async ({ db, headers, params: { id } }) => {
      const auth = await organizer(db, headers, id);
      if (auth.error) return auth.error;
      if (auth.tournament.internal_state !== "Preparing")
        return status(400, { message: "Tournament is not preparing" as const });
      await db.updateTable("event").set({ internal_state: "Ongoing" }).where("id", "=", id).execute();
      await db
        .insertInto("tournament_event")
        .values({
          tournament_id: id,
          type: "TOURNAMENT_STARTED",
          actor_id: auth.session.id,
          target_id: null,
          payload: null,
          reason: null,
        })
        .execute();
      return { success: true as const, internalState: "Ongoing" as const };
    },
    {
      params: t.Object({ id: t.Numeric() }),
      response: {
        200: t.Object({ success: t.Literal(true), internalState: t.Literal("Ongoing") }),
        400: t.Object({ message: t.String() }),
        401: t.Object({ message: t.Literal("Authentication required") }),
        403: t.Object({ message: t.Literal("Tournament organizer required") }),
        404: TournamentModel.notFound,
      },
    },
  )
  .put(
    "/next-phase/:id",
    async ({ db, headers, params: { id } }) => {
      const auth = await organizer(db, headers, id);
      if (auth.error) return auth.error;
      // Phase transitions are driven by the unified lifecycle worker. Keep this
      // command idempotent for legacy clients while making authorization and
      // state ownership API-side instead of bot-side.
      return { success: true as const, internalState: auth.tournament.internal_state ?? "Pending" };
    },
    {
      params: t.Object({ id: t.Numeric() }),
      response: {
        200: t.Object({ success: t.Literal(true), internalState: t.String() }),
        401: t.Object({ message: t.Literal("Authentication required") }),
        403: t.Object({ message: t.Literal("Tournament organizer required") }),
        404: TournamentModel.notFound,
      },
    },
  )
  .post(
    "/:id/apply-placement-prizes",
    async ({ db, headers, params: { id } }) => {
      const auth = await organizer(db, headers, id);
      if (auth.error) return auth.error;
      const result = await applyPlacementPrizes(db, id, auth.session.id);
      if (!result.applied && result.reason === "tournoi_non_termine")
        return status(400, { message: "Tournament is not finished" as const });
      return result;
    },
    {
      params: t.Object({ id: t.Numeric() }),
      response: {
        200: t.Object({
          applied: t.Boolean(),
          reason: t.Optional(t.String()),
          deltas: t.Optional(t.Record(t.String(), t.Number())),
          tournamentSize: t.Optional(t.Number()),
        }),
        400: t.Object({ message: t.String() }),
        401: t.Object({ message: t.Literal("Authentication required") }),
        403: t.Object({ message: t.Literal("Tournament organizer required") }),
        404: TournamentModel.notFound,
      },
    },
  )
  .post(
    "/internal/:id/apply-placement-prizes",
    async ({ db, headers, params: { id }, set }) => {
      const bearer = headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!verifyAdminBearerToken(bearer, process.env.API_ADMIN_TOKEN)) {
        set.status = 401;
        return { message: "Internal authentication required" as const };
      }
      return applyPlacementPrizes(db, id, null);
    },
    {
      params: t.Object({ id: t.Numeric() }),
      response: {
        200: t.Object({
          applied: t.Boolean(),
          reason: t.Optional(t.String()),
          deltas: t.Optional(t.Record(t.String(), t.Number())),
          tournamentSize: t.Optional(t.Number()),
        }),
        401: t.Object({ message: t.Literal("Internal authentication required") }),
      },
    },
  )
  .post(
    "/remove-participant/:id",
    async ({ db, headers, params: { id }, body }) => {
      const auth = await organizer(db, headers, id);
      if (auth.error) return auth.error;
      const participant = await db
        .selectFrom("tournament_participant")
        .select(["id", "user_id", "status"])
        .where("tournament_id", "=", id)
        .where("user_id", "=", body.userId)
        .executeTakeFirst();
      if (!participant) return status(404, { message: "Participant not found" as const });
      await db.deleteFrom("tournament_participant").where("id", "=", participant.id).execute();
      await db
        .insertInto("tournament_event")
        .values({
          tournament_id: id,
          type: "PARTICIPANT_REMOVED",
          actor_id: auth.session.id,
          target_id: body.userId,
          payload: null,
          reason: body.reason ?? null,
        })
        .execute();
      return { success: true as const, userId: body.userId };
    },
    {
      params: t.Object({ id: t.Numeric() }),
      body: t.Object({ userId: t.String(), reason: t.Optional(t.String()) }),
      response: {
        200: t.Object({ success: t.Literal(true), userId: t.String() }),
        401: t.Object({ message: t.Literal("Authentication required") }),
        403: t.Object({ message: t.Literal("Tournament organizer required") }),
        404: t.Object({ message: t.String() }),
      },
    },
  )
  .post(
    "/:id/disqualify",
    async ({ db, headers, params: { id }, body }) => {
      const auth = await organizer(db, headers, id);
      if (auth.error) return auth.error;
      const reason = body.reason.trim();
      if (reason.length < 3) return status(400, { message: "Disqualification reason is required" as const });
      const participant = await db
        .selectFrom("tournament_participant")
        .select(["id", "status"])
        .where("tournament_id", "=", id)
        .where("user_id", "=", body.userId)
        .executeTakeFirst();
      if (!participant) return status(404, { message: "Participant not found" as const });
      await db
        .updateTable("tournament_participant")
        .set({
          status: "Disqualified",
          status_reason: reason,
          status_actor_id: auth.session.id,
          status_changed_at: new Date(),
        })
        .where("id", "=", participant.id)
        .execute();
      await db
        .insertInto("tournament_event")
        .values({
          tournament_id: id,
          type: "PARTICIPANT_DISQUALIFIED",
          actor_id: auth.session.id,
          target_id: body.userId,
          payload: null,
          reason,
        })
        .execute();
      return { success: true as const, userId: body.userId, status: "Disqualified" as const };
    },
    {
      params: t.Object({ id: t.Numeric() }),
      body: t.Object({ userId: t.String(), reason: t.String() }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          userId: t.String(),
          status: t.Literal("Disqualified"),
        }),
        400: t.Object({ message: t.String() }),
        401: t.Object({ message: t.Literal("Authentication required") }),
        403: t.Object({ message: t.Literal("Tournament organizer required") }),
        404: t.Object({ message: t.String() }),
      },
    },
  )
  .post(
    "/:id/reinstate",
    async ({ db, headers, params: { id }, body }) => {
      const auth = await organizer(db, headers, id);
      if (auth.error) return auth.error;
      const participant = await db
        .selectFrom("tournament_participant")
        .select(["id", "status"])
        .where("tournament_id", "=", id)
        .where("user_id", "=", body.userId)
        .executeTakeFirst();
      if (!participant) return status(404, { message: "Participant not found" as const });
      if (participant.status !== "Disqualified")
        return status(400, { message: "Participant is not disqualified" as const });
      await db
        .updateTable("tournament_participant")
        .set({
          status: "Active",
          status_reason: null,
          status_actor_id: auth.session.id,
          status_changed_at: new Date(),
        })
        .where("id", "=", participant.id)
        .execute();
      await db
        .insertInto("tournament_event")
        .values({
          tournament_id: id,
          type: "PARTICIPANT_REINSTATED",
          actor_id: auth.session.id,
          target_id: body.userId,
          payload: null,
          reason: null,
        })
        .execute();
      return { success: true as const, userId: body.userId, status: "Active" as const };
    },
    {
      params: t.Object({ id: t.Numeric() }),
      body: t.Object({ userId: t.String() }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          userId: t.String(),
          status: t.Literal("Active"),
        }),
        400: t.Object({ message: t.String() }),
        401: t.Object({ message: t.Literal("Authentication required") }),
        403: t.Object({ message: t.Literal("Tournament organizer required") }),
        404: t.Object({ message: t.String() }),
      },
    },
  )
  .post(
    "/:id/promote-participant",
    async ({ db, headers, params: { id }, body }) => {
      const auth = await organizer(db, headers, id);
      if (auth.error) return auth.error;
      const participant = await db
        .selectFrom("tournament_participant")
        .select(["id", "status"])
        .where("tournament_id", "=", id)
        .where("user_id", "=", body.userId)
        .executeTakeFirst();
      if (!participant) return status(404, { message: "Participant not found" as const });
      if (participant.status !== "Waitlisted")
        return status(400, { message: "Participant is not waitlisted" as const });
      await db
        .updateTable("tournament_participant")
        .set({ status: "Active", status_actor_id: auth.session.id, status_changed_at: new Date() })
        .where("id", "=", participant.id)
        .execute();
      await db
        .insertInto("tournament_event")
        .values({
          tournament_id: id,
          type: "PARTICIPANT_PROMOTED",
          actor_id: auth.session.id,
          target_id: body.userId,
          payload: null,
          reason: null,
        })
        .execute();
      return { success: true as const, userId: body.userId, status: "Active" as const };
    },
    {
      params: t.Object({ id: t.Numeric() }),
      body: t.Object({ userId: t.String() }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          userId: t.String(),
          status: t.Literal("Active"),
        }),
        400: t.Object({ message: t.String() }),
        401: t.Object({ message: t.Literal("Authentication required") }),
        403: t.Object({ message: t.Literal("Tournament organizer required") }),
        404: t.Object({ message: t.String() }),
      },
    },
  )
  .post(
    "/:id/score-policy",
    async ({ db, headers, params: { id }, body }) => {
      const session = await resolveAchilleaSession(headers);
      if (!session) return status(401, { message: "Authentication required" as const });
      if (body.policy !== "players" && body.policy !== "staff_only")
        return status(400, { message: "Unknown score policy" as const });
      const tournament = await db
        .selectFrom("event")
        .select(["id", "organization_id"])
        .where("id", "=", id)
        .where("type", "=", "TOURNAMENT")
        .executeTakeFirst();
      if (!tournament) return status(404, { message: "Tournament not found" as const });
      const actor = await db.selectFrom("user").select("role").where("id", "=", session.id).executeTakeFirst();
      const manager =
        tournament.organization_id === null
          ? null
          : await db
              .selectFrom("organization_manager")
              .select("organization_id")
              .where("organization_id", "=", tournament.organization_id)
              .where("user_id", "=", session.id)
              .executeTakeFirst();
      const owner =
        tournament.organization_id === null
          ? null
          : await db
              .selectFrom("organization")
              .select("owner_id")
              .where("id", "=", tournament.organization_id)
              .where("owner_id", "=", session.id)
              .executeTakeFirst();
      if (!actor || (actor.role < 2 && !manager && !owner))
        return status(403, { message: "Tournament organizer required" as const });
      await db.updateTable("event").set({ score_report_policy: body.policy }).where("id", "=", id).execute();
      return { success: true as const, scoreReportPolicy: body.policy };
    },
    {
      params: t.Object({ id: t.Numeric() }),
      body: t.Object({ policy: t.String() }),
      response: {
        200: TournamentModel.scorePolicy,
        400: t.Object({ message: t.String() }),
        401: t.Object({ message: t.Literal("Authentication required") }),
        403: t.Object({ message: t.Literal("Tournament organizer required") }),
        404: TournamentModel.notFound,
      },
    },
  )
  .post(
    "/participate/:id",
    async ({ db, headers, params: { id } }) => {
      const session = await resolveAchilleaSession(headers);
      if (!session) return status(401, { message: "Authentication required" as const });
      const result = await db.transaction().execute(async trx => {
        const tournament = await trx
          .selectFrom("event")
          .select(["id", "internal_state", "participants_number"])
          .where("id", "=", id)
          .where("type", "=", "TOURNAMENT")
          .forUpdate()
          .executeTakeFirst();
        if (!tournament) return status(404, { message: "Tournament not found" as const });
        if (tournament.internal_state !== "Preregistering" && tournament.internal_state !== "Preparing")
          return status(400, { message: "Registrations are closed" as const });
        const existing = await trx
          .selectFrom("tournament_participant")
          .select(["id", "status"])
          .where("tournament_id", "=", id)
          .where("user_id", "=", session.id)
          .executeTakeFirst();
        if (existing)
          return status(409, {
            message:
              existing.status === "Waitlisted"
                ? "Already waitlisted"
                : existing.status === "Disqualified"
                  ? "Disqualified from tournament"
                  : ("Already registered" as const),
          });
        const active = await trx
          .selectFrom("tournament_participant")
          .select(({ fn }) => fn.countAll<number>().as("count"))
          .where("tournament_id", "=", id)
          .where("status", "=", "Active")
          .executeTakeFirst();
        const waitlisted = Boolean(
          tournament.participants_number && Number(active?.count ?? 0) >= tournament.participants_number,
        );
        const statusValue = waitlisted ? ("Waitlisted" as const) : ("Active" as const);
        const participant = await trx
          .insertInto("tournament_participant")
          .values({
            tournament_id: id,
            user_id: session.id,
            status: statusValue,
            registered_at: new Date(),
            bracket_participant_id: null,
            seed: null,
            has_checked_in: false,
            status_changed_at: null,
            status_reason: null,
            status_actor_id: null,
          })
          .returning(["id", "tournament_id", "user_id", "status", "registered_at"])
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("tournament_event")
          .values({
            tournament_id: id,
            type: waitlisted ? "PARTICIPANT_WAITLISTED" : "PARTICIPANT_REGISTERED",
            actor_id: session.id,
            target_id: session.id,
            payload: null,
            reason: null,
          })
          .execute();
        if (
          !waitlisted &&
          tournament.internal_state === "Preregistering" &&
          tournament.participants_number &&
          Number(active?.count ?? 0) + 1 >= tournament.participants_number
        )
          await trx.updateTable("event").set({ internal_state: "Preparing" }).where("id", "=", id).execute();
        return {
          id: participant.id,
          tournamentId: participant.tournament_id,
          userId: participant.user_id,
          status: participant.status,
          registeredAt: participant.registered_at.toISOString(),
        };
      });
      return result;
    },
    {
      params: t.Object({ id: t.Numeric() }),
      response: {
        200: TournamentModel.participant,
        400: t.Object({ message: t.String() }),
        401: t.Object({ message: t.Literal("Authentication required") }),
        404: TournamentModel.notFound,
        409: t.Object({ message: t.String() }),
      },
    },
  )
  .post(
    "/unregister/:id",
    async ({ db, headers, params: { id } }) => {
      const session = await resolveAchilleaSession(headers);
      if (!session) return status(401, { message: "Authentication required" as const });
      return db.transaction().execute(async trx => {
        const tournament = await trx
          .selectFrom("event")
          .select(["id", "internal_state"])
          .where("id", "=", id)
          .where("type", "=", "TOURNAMENT")
          .forUpdate()
          .executeTakeFirst();
        if (!tournament) return status(404, { message: "Tournament not found" as const });
        if (tournament.internal_state !== "Preregistering" && tournament.internal_state !== "Preparing")
          return status(400, { message: "Registrations are closed" as const });
        const participant = await trx
          .selectFrom("tournament_participant")
          .selectAll()
          .where("tournament_id", "=", id)
          .where("user_id", "=", session.id)
          .forUpdate()
          .executeTakeFirst();
        if (!participant) return status(409, { message: "Not registered" as const });
        const wasActive = participant.status === "Active";
        await trx.deleteFrom("tournament_participant").where("id", "=", participant.id).execute();
        if (wasActive) {
          const next = await trx
            .selectFrom("tournament_participant")
            .select("id")
            .where("tournament_id", "=", id)
            .where("status", "=", "Waitlisted")
            .orderBy("registered_at", "asc")
            .forUpdate()
            .executeTakeFirst();
          if (next)
            await trx
              .updateTable("tournament_participant")
              .set({ status: "Active", status_changed_at: new Date(), status_actor_id: session.id })
              .where("id", "=", next.id)
              .execute();
        }
        await trx
          .insertInto("tournament_event")
          .values({
            tournament_id: id,
            type: "PARTICIPANT_UNREGISTERED",
            actor_id: session.id,
            target_id: session.id,
            payload: null,
            reason: null,
          })
          .execute();
        return { success: true as const, promoted: wasActive };
      });
    },
    {
      params: t.Object({ id: t.Numeric() }),
      response: {
        200: t.Object({ success: t.Literal(true), promoted: t.Boolean() }),
        400: t.Object({ message: t.String() }),
        401: t.Object({ message: t.Literal("Authentication required") }),
        404: TournamentModel.notFound,
        409: t.Object({ message: t.String() }),
      },
    },
  )
  .post(
    "/report-score",
    async ({ db, headers, body }) => {
      const access = await lobbyAccess(db, headers, body.lobbyId);
      if ("unauthenticated" in access) return status(401, { message: "Authentication required" as const });
      if ("notFound" in access) return status(404, { message: "Lobby not found" as const });
      if (isLobbyFinished(access.lobby.state))
        return status(400, { message: "This lobby is already finished" as const });
      if (!access.player && !access.isOrganizer) return status(403, { message: "Lobby participant required" as const });
      if (!canReport(access)) return status(403, { message: "Only tournament organizers may report scores" as const });
      const game = await db
        .selectFrom("lobby_match")
        .selectAll()
        .where("lobby_id", "=", body.lobbyId)
        .where("game_number", "=", body.gameNumber)
        .executeTakeFirst();
      if (!game) return status(404, { message: "Game not found" as const });
      if (game.admin_validated && !access.isOrganizer)
        return status(409, { message: "Score already validated by an organizer" as const });
      await db.transaction().execute(async trx => {
        await trx
          .updateTable("lobby_match")
          .set({
            score_team1: body.score1,
            score_team2: body.score2,
            team1validated: false,
            team2validated: false,
            admin_validated: false,
            updated_at: new Date(),
          })
          .where("id", "=", game.id)
          .execute();
        if (access.lobby.state === "Fresh" || access.lobby.state === "Ongoing") {
          await trx
            .updateTable("lobby")
            .set({ state: "Pending validation", updated_at: new Date() })
            .where("id", "=", body.lobbyId)
            .execute();
        }
        await trx
          .insertInto("tournament_event")
          .values({
            tournament_id: access.lobby.event_id,
            type: "SCORE_REPORTED",
            actor_id: access.session.id,
            target_id: null,
            payload: {
              lobbyId: body.lobbyId,
              gameNumber: body.gameNumber,
              scoreTeam1: body.score1,
              scoreTeam2: body.score2,
              reportedBy: access.isOrganizer ? "organizer" : "player",
            },
            reason: null,
          })
          .execute();
      });
      return { success: true as const, lobbyId: body.lobbyId, gameNumber: body.gameNumber };
    },
    {
      body: t.Object({
        lobbyId: t.Integer(),
        gameNumber: t.Integer({ minimum: 1 }),
        score1: t.Integer({ minimum: 0, maximum: 99 }),
        score2: t.Integer({ minimum: 0, maximum: 99 }),
      }),
      response: {
        200: t.Object({ success: t.Literal(true), lobbyId: t.Number(), gameNumber: t.Number() }),
        400: t.Object({ message: t.String() }),
        401: t.Object({ message: t.Literal("Authentication required") }),
        403: t.Object({ message: t.String() }),
        404: t.Object({ message: t.String() }),
        409: t.Object({ message: t.String() }),
      },
    },
  )
  .post(
    "/validate-score",
    async ({ db, headers, body }) => {
      const access = await lobbyAccess(db, headers, body.lobbyId);
      if ("unauthenticated" in access) return status(401, { message: "Authentication required" as const });
      if ("notFound" in access) return status(404, { message: "Lobby not found" as const });
      if (isLobbyFinished(access.lobby.state))
        return status(400, { message: "This lobby is already finished" as const });
      const game = await db
        .selectFrom("lobby_match")
        .selectAll()
        .where("id", "=", body.lobbyMatchId)
        .where("lobby_id", "=", body.lobbyId)
        .executeTakeFirst();
      if (!game) return status(404, { message: "Game not found" as const });
      const side = access.isOrganizer
        ? "ADMIN"
        : access.player?.team === 1
          ? "TEAM_1"
          : access.player?.team === 2
            ? "TEAM_2"
            : null;
      if (!side) return status(403, { message: "Lobby participant required" as const });
      if (game.admin_validated || (game.team1validated && game.team2validated))
        return status(409, { message: "Game already validated" as const });
      const patch =
        side === "ADMIN"
          ? { admin_validated: true }
          : side === "TEAM_1"
            ? { team1validated: true }
            : { team2validated: true };
      await db
        .updateTable("lobby_match")
        .set({ ...patch, updated_at: new Date() })
        .where("id", "=", game.id)
        .execute();
      await db
        .insertInto("tournament_event")
        .values({
          tournament_id: access.lobby.event_id,
          type: "SCORE_VALIDATED",
          actor_id: access.session.id,
          target_id: null,
          payload: {
            lobbyId: body.lobbyId,
            gameNumber: game.game_number,
            side,
            scoreTeam1: game.score_team1,
            scoreTeam2: game.score_team2,
          },
          reason: null,
        })
        .execute();
      return { success: true as const, side };
    },
    {
      body: t.Object({ lobbyId: t.Integer(), lobbyMatchId: t.Integer() }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          side: t.Union([t.Literal("ADMIN"), t.Literal("TEAM_1"), t.Literal("TEAM_2")]),
        }),
        400: t.Object({ message: t.String() }),
        401: t.Object({ message: t.Literal("Authentication required") }),
        403: t.Object({ message: t.String() }),
        404: t.Object({ message: t.String() }),
        409: t.Object({ message: t.String() }),
      },
    },
  )
  .post(
    "/unvalidate-score",
    async ({ db, headers, body }) => {
      const access = await lobbyAccess(db, headers, body.lobbyId);
      if ("unauthenticated" in access) return status(401, { message: "Authentication required" as const });
      if ("notFound" in access) return status(404, { message: "Lobby not found" as const });
      if (isLobbyFinished(access.lobby.state))
        return status(400, { message: "This lobby is already finished" as const });
      const game = await db
        .selectFrom("lobby_match")
        .selectAll()
        .where("id", "=", body.lobbyMatchId)
        .where("lobby_id", "=", body.lobbyId)
        .executeTakeFirst();
      if (!game) return status(404, { message: "Game not found" as const });
      const side = access.isOrganizer
        ? "ADMIN"
        : access.player?.team === 1
          ? "TEAM_1"
          : access.player?.team === 2
            ? "TEAM_2"
            : null;
      if (!side) return status(403, { message: "Lobby participant required" as const });
      const patch =
        side === "ADMIN"
          ? { admin_validated: false, team1validated: false, team2validated: false }
          : side === "TEAM_1"
            ? { team1validated: false }
            : { team2validated: false };
      await db
        .updateTable("lobby_match")
        .set({ ...patch, updated_at: new Date() })
        .where("id", "=", game.id)
        .execute();
      return { success: true as const, side };
    },
    {
      body: t.Object({ lobbyId: t.Integer(), lobbyMatchId: t.Integer() }),
      response: {
        200: t.Object({
          success: t.Literal(true),
          side: t.Union([t.Literal("ADMIN"), t.Literal("TEAM_1"), t.Literal("TEAM_2")]),
        }),
        400: t.Object({ message: t.String() }),
        401: t.Object({ message: t.Literal("Authentication required") }),
        403: t.Object({ message: t.String() }),
        404: t.Object({ message: t.String() }),
      },
    },
  )
  .get(
    "/lobbies/:id",
    async ({ db, params: { id } }) => {
      const rows = await db
        .selectFrom("lobby")
        .select("id")
        .where("event_id", "=", id)
        .orderBy("state", "asc")
        .orderBy("id", "asc")
        .execute();
      return (await Promise.all(rows.map(row => serializeLobby(db, Number(row.id), false)))).filter(
        (row): row is NonNullable<typeof row> => row !== null,
      );
    },
    { params: t.Object({ id: t.Integer() }), response: t.Array(t.Any()) },
  )
  .get(
    "/lobby/:id",
    async ({ db, params: { id } }) => {
      const lobby = await serializeLobby(db, id, true);
      if (!lobby) return status(404, { message: "Lobby not found" as const });
      return lobby;
    },
    {
      params: t.Object({ id: t.Integer() }),
      response: { 200: t.Any(), 404: t.Object({ message: t.Literal("Lobby not found") }) },
    },
  )
  .get(
    "/",
    async ({ db, query }) => {
      const states = query.states === undefined ? [] : Array.isArray(query.states) ? query.states : [query.states];
      return await TournamentService.findAll(
        db,
        query.page,
        query.pageSize ?? query.pagination,
        query.organization,
        states,
      );
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric({ minimum: 1 })),
        pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
        pagination: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
        organization: t.Optional(t.Numeric({ minimum: 1 })),
        states: t.Optional(t.Union([t.String(), t.Array(t.String())])),
      }),
      response: {
        200: TournamentModel.listResponse,
      },
    },
  )
  .get(
    "/:id/events",
    async ({ db, params: { id }, headers }) => {
      const session = await resolveAchilleaSession(headers);
      const tournament = await db
        .selectFrom("event")
        .select(["id", "organization_id"])
        .where("id", "=", id)
        .where("type", "=", "TOURNAMENT")
        .executeTakeFirst();
      if (!tournament) return status(404, { message: "Tournament not found" as const });
      let includeReasons = false;
      if (session && tournament.organization_id !== null) {
        const actor = await db.selectFrom("user").select("role").where("id", "=", session.id).executeTakeFirst();
        const managed = await db
          .selectFrom("organization_manager")
          .select("organization_id")
          .where("organization_id", "=", tournament.organization_id)
          .where("user_id", "=", session.id)
          .executeTakeFirst();
        const owner = await db
          .selectFrom("organization")
          .select("owner_id")
          .where("id", "=", tournament.organization_id)
          .where("owner_id", "=", session.id)
          .executeTakeFirst();
        includeReasons = Boolean((actor && actor.role >= 2) || managed || owner);
      }
      const rows = await db
        .selectFrom("tournament_event as event")
        .leftJoin("user as actor", "actor.id", "event.actor_id")
        .leftJoin("user as target", "target.id", "event.target_id")
        .select([
          "event.id",
          "event.type",
          "event.created_at",
          "event.payload",
          "event.reason",
          "actor.id as actor_id",
          "actor.username as actor_username",
          "actor.display_name as actor_display_name",
          "actor.avatar as actor_avatar",
          "target.id as target_id",
          "target.username as target_username",
          "target.display_name as target_display_name",
          "target.avatar as target_avatar",
        ])
        .where("event.tournament_id", "=", id)
        .orderBy("event.created_at", "desc")
        .limit(200)
        .execute();
      return rows.map(event => ({
        id: event.id,
        type: event.type,
        createdAt: event.created_at.toISOString(),
        actor: event.actor_id
          ? {
              id: event.actor_id,
              username: event.actor_username,
              displayName: event.actor_display_name,
              avatar: event.actor_avatar,
            }
          : null,
        target: event.target_id
          ? {
              id: event.target_id,
              username: event.target_username,
              displayName: event.target_display_name,
              avatar: event.target_avatar,
            }
          : null,
        payload: event.payload,
        reason: includeReasons ? event.reason : null,
      }));
    },
    {
      params: t.Object({ id: t.Numeric() }),
      response: { 200: t.Array(TournamentModel.event), 404: TournamentModel.notFound },
    },
  )
  .get(
    "/:id",
    async ({ db, params: { id } }) => {
      const item = await TournamentService.findDetail(db, id, false);
      if (!item) {
        return status(404, { message: "Tournament not found" as const });
      }
      return item;
    },
    {
      params: t.Object({
        id: t.Numeric(),
      }),
      response: {
        200: t.Any(),
        404: TournamentModel.notFound,
      },
    },
  );
