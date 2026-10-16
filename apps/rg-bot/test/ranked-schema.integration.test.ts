import "./setup";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { SQL } from "bun";

const fixtureUrl = process.env.RANKED_TEST_DATABASE_URL;

describe.skipIf(!fixtureUrl)("ranked SQL schema isolation", () => {
  let sql: SQL;
  let persistence: typeof import("../src/api/ranked/persistence");
  let telemetry: typeof import("../src/api/ranked/telemetry");
  let db: typeof import("../src/api/ranked/db");
  let eventId: number;
  const previousUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    const url = new URL(fixtureUrl!);
    if (
      !url.pathname.startsWith("/ranked_test_") ||
      !["127.0.0.1", "localhost"].includes(url.hostname)
    ) {
      throw new Error("Ranked integration requires a disposable loopback ranked_test_* database");
    }
    process.env.DATABASE_URL = fixtureUrl;
    db = await import("../src/api/ranked/db");
    sql = db.sql;
    const [context] =
      await sql`SELECT current_database() AS name, current_setting('search_path') AS path`;
    expect(context.name).toStartWith("ranked_test_");
    expect(context.path).not.toContain("achillea");
    const [existing] = await sql`SELECT to_regnamespace('achillea') AS namespace`;
    if (existing.namespace !== null) throw new Error("Ranked fixture database must be fresh");

    await sql
      .unsafe(`
      CREATE SCHEMA achillea;
      CREATE TABLE achillea."user" (id text PRIMARY KEY, display_name text, avatar text, role int);
      CREATE TABLE achillea.event (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name text, description text, type text,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE achillea.rank (
        id int PRIMARY KEY, key text, min_elo int, max_elo int,
        emoji_id text, emoji_key text, gradient text[]
      );
      CREATE TABLE achillea.user_elo (
        user_id text REFERENCES achillea."user", mode int, season_id uuid,
        elo int, peak_rating int, games_played int, wins int, losses int,
        updated_at timestamptz DEFAULT now(), PRIMARY KEY (user_id, mode)
      );
      INSERT INTO achillea."user" VALUES ('p1', 'Player One', '', 0), ('p2', 'Player Two', '', 0);
      INSERT INTO achillea.rank VALUES (1, 'bronze', 0, 10000, '', '', '{}');
    `)
      .simple();
    // Lobby column and foreign-key contracts come from the owning RG migration.
    const migration = await Bun.file(
      new URL(
        "../../website/sql/migrations/20260922_achillea_tournament_lobbies.sql",
        import.meta.url,
      ),
    ).text();
    await sql.unsafe(migration).simple();
    const telemetryMigration = await Bun.file(
      new URL("../../website/sql/migrations/20261001_ranked_telemetry.sql", import.meta.url),
    ).text();
    await sql.unsafe(telemetryMigration).simple();
    await sql.unsafe(telemetryMigration).simple();
    await Promise.all(
      ["event", "lobby", "lobby_user", "lobby_match", "user_elo", "ranked_match_event", "user"].map(
        (table) =>
          sql.unsafe(`CREATE TABLE public."${table}" (LIKE achillea."${table}" INCLUDING ALL)`),
      ),
    );
    persistence = await import("../src/api/ranked/persistence");
    telemetry = await import("../src/api/ranked/telemetry");
    eventId = await persistence.getOrCreatePerpetualRankedEventId();
    await db.getOrCreateElo("p1", 2, null, 100);
    await db.getOrCreateElo("p2", 2, null, 100);
  });

  afterAll(async () => {
    await sql?.end();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  });

  const match = () => ({
    eventId,
    mode: 2,
    p1: { userId: "p1", eloBefore: 100, score: 2 },
    p2: { userId: "p2", eloBefore: 100, score: 1 },
    contested: false,
    adminValidated: true,
  });

  it("persists, reads and finalizes a match without touching public shadow tables", async () => {
    const { lobbyId } = await persistence.createOngoingLobby(match());
    expect(typeof eventId).toBe("number");
    expect(await persistence.getOrCreatePerpetualRankedEventId()).toBe(eventId);
    expect(typeof lobbyId).toBe("number");
    expect((await persistence.listActiveLobbies()).map((lobby) => lobby.lobbyId)).toContain(
      lobbyId,
    );
    await persistence.finalizeOngoingLobby(lobbyId, match(), 20);
    await persistence.finalizeOngoingLobby(lobbyId, match(), 20);
    const players = await sql<
      Array<{ games_played: number }>
    >`SELECT games_played FROM achillea.user_elo ORDER BY user_id`;
    expect(players.map((player) => player.games_played)).toEqual([1, 1]);
    expect((await persistence.getRankedOverview()).finishedToday).toBe(1);
    expect(await persistence.cancelLobby(lobbyId)).toBe(false);
    await Promise.all(
      ["event", "lobby", "lobby_user", "lobby_match", "user_elo"].map(async (table) => {
        const [row] = await sql.unsafe(`SELECT count(*)::int AS count FROM public."${table}"`);
        expect(row.count).toBe(0);
      }),
    );
  });

  it("writes and joins telemetry in Achillea rather than public", async () => {
    await telemetry.logMatchEvent({
      type: "queue_join",
      userId: "p1",
      mode: 2,
      detail: { fixture: true },
    });
    const events = await telemetry.listMatchEvents({ userId: "p1" });
    expect(events).toHaveLength(1);
    expect(typeof events[0]!.id).toBe("number");
    expect(events[0]).toMatchObject({
      display_name: "Player One",
      event_type: "queue_join",
      detail: { fixture: true },
    });
    const [row] = await sql`SELECT count(*)::int AS count FROM public.ranked_match_event`;
    expect(row.count).toBe(0);
  });

  it("rejects bigint identifiers that cannot be represented exactly", async () => {
    await sql`INSERT INTO achillea.ranked_match_event (id, event_type) OVERRIDING SYSTEM VALUE VALUES (9007199254740993, 'queue_join')`;
    await expect(telemetry.listMatchEvents()).rejects.toThrow("safe-integer range");
  });

  it("cancels only stale ongoing ranked matches and preserves tournaments and disputes", async () => {
    await sql`
      INSERT INTO achillea.lobby (event_id, event_type, state, created_at) VALUES
      (${eventId}, 'RANKED', 'Ongoing', now() - interval '2 days'),
      (${eventId}, 'TOURNAMENT', 'Ongoing', now() - interval '2 days'),
      (${eventId}, 'RANKED', 'Contested', now() - interval '2 days')
    `;
    expect(await persistence.cleanupStaleOngoingLobbies(24)).toBe(1);
    const rows = await sql<
      Array<{ event_type: string; state: string }>
    >`SELECT event_type, state FROM achillea.lobby WHERE created_at < now() - interval '1 day' ORDER BY id`;
    expect(rows.map((row) => [row.event_type, row.state])).toEqual([
      ["RANKED", "Canceled"],
      ["TOURNAMENT", "Ongoing"],
      ["RANKED", "Contested"],
    ]);
  });
});
