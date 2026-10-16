import type { CrudInterface, DataTypes, OmitId, Table } from "brackets-manager";
import { BracketsManager } from "brackets-manager";
import type { Id } from "brackets-model";
import { sql, type RawBuilder } from "kysely";
import type { Kysely } from "kysely";
import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";
import type { Database } from "@rosegriffon/db/schema";

type BracketDatabase = Record<string, never>;
const bracketDb = createAchilleaSql<BracketDatabase>();

class KyselyBracketAdapter implements CrudInterface {
  constructor(private readonly prefix = "bm_") {}
  private tableName(table: Table) {
    const value = `${this.prefix}${String(table)}`;
    if (!/^bm_[a-z][a-z0-9_]*$/u.test(value)) throw new Error(`Invalid bracket table: ${value}`);
    return value;
  }
  private identifier(value: string): RawBuilder<unknown> {
    if (!/^[a-z][a-z0-9_]*$/u.test(value)) throw new Error(`Invalid bracket column: ${value}`);
    return sql.raw(`"${value}"`);
  }
  private columns(values: string[]) {
    return sql.join(
      values.map(value => this.identifier(value)),
      sql`, `,
    );
  }
  private row(value: Record<string, unknown>, columns: string[]) {
    return sql`(${sql.join(
      columns.map(column => sql`${value[column]}`),
      sql`, `,
    )})`;
  }
  async insert<T extends Table>(table: T, value: OmitId<DataTypes[T]> | OmitId<DataTypes[T]>[]): Promise<any> {
    const rows = (Array.isArray(value) ? value : [value]) as Record<string, unknown>[];
    if (!rows.length) return true;
    const columns = Object.keys(rows[0] ?? {});
    const result =
      await sql`INSERT INTO ${sql.raw(`"${this.tableName(table)}"`)} (${this.columns(columns)}) VALUES ${sql.join(
        rows.map(entry => this.row(entry, columns)),
        sql`, `,
      )}${Array.isArray(value) ? sql`` : sql` RETURNING "id"`}`.execute(bracketDb);
    return Array.isArray(value) ? true : ((result.rows as Array<{ id?: number }>)[0]?.id ?? null);
  }
  async select<T extends Table>(table: T, filter?: Id | Partial<DataTypes[T]>): Promise<any> {
    const entries: Array<[string, unknown]> =
      filter === undefined
        ? []
        : typeof filter === "object"
          ? Object.entries(filter as object).filter(([, value]) => value !== undefined)
          : [["id", filter]];
    const where = entries.length
      ? sql` WHERE ${sql.join(
          entries.map(([column, value]) => sql`${this.identifier(column)} = ${value}`),
          sql` AND `,
        )}`
      : sql``;
    const result = await sql`SELECT * FROM ${sql.raw(`"${this.tableName(table)}"`)}${where} ORDER BY "id" ASC`.execute(
      bracketDb,
    );
    const rows = result.rows as DataTypes[T][];
    return typeof filter === "number" || typeof filter === "string" ? (rows[0] ?? null) : rows;
  }
  async update<T extends Table>(
    table: T,
    filter: Id | Partial<DataTypes[T]>,
    value?: Partial<DataTypes[T]>,
  ): Promise<boolean> {
    if (!value) return false;
    const sets = Object.entries(value as object).filter(([, entry]) => entry !== undefined);
    const entries: Array<[string, unknown]> =
      typeof filter === "object"
        ? Object.entries(filter as object).filter(([, entry]) => entry !== undefined)
        : [["id", filter]];
    const where = entries.length
      ? sql` WHERE ${sql.join(
          entries.map(([column, entry]) => sql`${this.identifier(column)} = ${entry}`),
          sql` AND `,
        )}`
      : sql``;
    const result = await sql`UPDATE ${sql.raw(`"${this.tableName(table)}"`)} SET ${sql.join(
      sets.map(([column, entry]) => sql`${this.identifier(column)} = ${entry}`),
      sql`, `,
    )}${where}`.execute(bracketDb);
    return Number(result.numAffectedRows ?? 0) > 0;
  }
  async delete<T extends Table>(table: T, filter?: Partial<DataTypes[T]>): Promise<boolean> {
    const entries = filter ? Object.entries(filter as object).filter(([, value]) => value !== undefined) : [];
    const where = entries.length
      ? sql` WHERE ${sql.join(
          entries.map(([column, value]) => sql`${this.identifier(column)} = ${value}`),
          sql` AND `,
        )}`
      : sql``;
    await sql`DELETE FROM ${sql.raw(`"${this.tableName(table)}"`)}${where}`.execute(bracketDb);
    return true;
  }
}

const manager = new BracketsManager(new KyselyBracketAdapter());

export async function rebuildTournamentBracket(db: Kysely<Database>, tournamentId: number): Promise<boolean> {
  const tournament = await db
    .selectFrom("event")
    .select(["id", "name", "internal_state", "tournament_type", "participants_number", "seed_ordering"])
    .where("id", "=", tournamentId)
    .where("type", "=", "TOURNAMENT")
    .executeTakeFirst();
  if (
    !tournament ||
    !tournament.participants_number ||
    !(["Preregistering", "Preparing"] as const).includes(tournament.internal_state as "Preregistering" | "Preparing") ||
    tournament.tournament_type === "league"
  )
    return false;
  const type = (tournament.tournament_type ?? "single_elimination") as
    "single_elimination" | "double_elimination" | "round_robin";
  const participants = await db
    .selectFrom("tournament_participant as p")
    .innerJoin("user as u", "u.id", "p.user_id")
    .select(["p.id", "p.bracket_participant_id", "p.seed", "u.display_name", "u.username"])
    .where("p.tournament_id", "=", tournamentId)
    .where("p.status", "=", "Active")
    .orderBy("p.id", "asc")
    .execute();
  // A bracket with fewer than two actual entrants is not a competition. Never
  // truncate the seed list to fit a stale capacity setting.
  if (participants.length < 2 || participants.length > tournament.participants_number) return false;
  const previous = await manager.get.currentStage(tournamentId);
  if (previous) {
    const matches = await manager.storage.select("match", { stage_id: previous.id });
    // Rebuilding discards the stage. Once play or reporting has begun, retain
    // the existing tree and its results even if the event state is stale.
    if (
      !matches ||
      matches.some(
        match =>
          match.status >= 4 ||
          match.opponent1?.result !== undefined ||
          match.opponent2?.result !== undefined ||
          match.opponent1?.score !== undefined ||
          match.opponent2?.score !== undefined,
      )
    )
      return false;
  }
  for (const participant of participants) {
    if (participant.bracket_participant_id !== null) continue;
    const bracketId = Number(
      await manager.storage.insert("participant", {
        tournament_id: tournamentId,
        name: participant.display_name || participant.username || String(participant.id),
      }),
    );
    await db
      .updateTable("tournament_participant")
      .set({ bracket_participant_id: bracketId, updated_at: new Date() })
      .where("id", "=", participant.id)
      .execute();
    participant.bracket_participant_id = bracketId;
  }
  if (previous) await manager.delete.stage(previous.id);
  const seeding = participants
    .slice()
    .sort((a, b) => (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER) || a.id - b.id)
    .map(participant => Number(participant.bracket_participant_id));
  const stage = await manager.create.stage({
    tournamentId,
    name: tournament.name,
    type,
    seeding,
    settings:
      type === "round_robin"
        ? { size: tournament.participants_number, groupCount: 1 }
        : {
            size: tournament.participants_number,
            seedOrdering: [(tournament.seed_ordering ?? "inner_outer") as "inner_outer"],
            consolationFinal: false,
          },
  });
  await manager.update.confirmSeeding(stage.id);
  return true;
}

export async function tournamentBracketData(tournamentId: number) {
  return manager.get.tournamentData(tournamentId);
}

/** Résout le classement final et le remappe vers les identifiants Achillea. */
export async function finalTournamentStandings(db: Kysely<Database>, tournamentId: number) {
  // currentStage deliberately returns null once every match is completed.
  // Circuit standings need the last persisted stage precisely in that case.
  const stages = await manager.storage.select("stage", { tournament_id: tournamentId });
  const stage = stages?.at(-1);
  if (!stage) return [];
  const standings = await manager.get.finalStandings(stage.id);
  const participants = await db
    .selectFrom("tournament_participant")
    .select(["user_id", "bracket_participant_id"])
    .where("tournament_id", "=", tournamentId)
    .where("bracket_participant_id", "is not", null)
    .execute();
  const userByBracket = new Map(participants.map(p => [Number(p.bracket_participant_id), p.user_id]));
  return standings
    .map(row => ({ userId: userByBracket.get(Number(row.id)), rank: Number(row.rank) }))
    .filter((row): row is { userId: string; rank: number } => Boolean(row.userId) && Number.isFinite(row.rank));
}
