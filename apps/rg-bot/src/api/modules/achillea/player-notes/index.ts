import { Elysia, status, t } from "elysia";
import type { Kysely } from "kysely";
import type { Database } from "@rosegriffon/db/schema";
import { dbPlugin } from "../../../plugins/db";
import { resolveAchilleaSession } from "../../auth/session";

const person = (prefix: string) => [
  `${prefix}.id as ${prefix}_id`,
  `${prefix}.username as ${prefix}_username`,
  `${prefix}.display_name as ${prefix}_display_name`,
  `${prefix}.avatar as ${prefix}_avatar`,
] as const;

async function access(db: Kysely<Database>, headers: { authorization?: string; cookie?: string }, tournamentId?: number | null) {
  const session = await resolveAchilleaSession(headers);
  if (!session) return { error: status(401, { message: "Authentication required" as const }) };
  const actor = await db.selectFrom("user").select("role").where("id", "=", session.id).executeTakeFirst();
  const staff = (actor?.role ?? 0) >= 2;
  if (!staff && tournamentId !== undefined && tournamentId !== null) {
    const manager = await db.selectFrom("event_managers").select("event_id").where("event_id", "=", tournamentId).where("user_id", "=", session.id).executeTakeFirst();
    if (manager) return { session, staff: false };
  }
  if (!staff) return { error: status(403, { message: "Staff or tournament organizer required" as const }) };
  return { session, staff: true };
}

function dto(row: any) {
  const user = (prefix: string) => row[`${prefix}_id`] ? {
    id: row[`${prefix}_id`], username: row[`${prefix}_username`],
    displayName: row[`${prefix}_display_name`], avatar: row[`${prefix}_avatar`],
  } : null;
  return {
    id: row.id, target: user("target"), author: user("author"),
    tournament: row.tournament_id_join ? { id: row.tournament_id_join, name: row.tournament_name } : null,
    category: row.category, severity: row.severity, content: row.content,
    resolved: Boolean(row.resolved), resolvedAt: row.resolved_at,
    resolvedBy: user("resolved_by"), createdAt: row.created_at, updatedAt: row.updated_at,
    docsUrl: null,
  };
}

function query(db: Kysely<Database>) {
  return db.selectFrom("player_note as note")
    .leftJoin("user as target", "target.id", "note.target_id")
    .leftJoin("user as author", "author.id", "note.author_id")
    .leftJoin("user as resolved_by", "resolved_by.id", "note.resolved_by_id")
    .leftJoin("event as tournament", "tournament.id", "note.tournament_id")
    .selectAll("note")
    .select([
      ...person("target"), ...person("author"), ...person("resolved_by"),
      "tournament.id as tournament_id_join", "tournament.name as tournament_name",
    ] as any);
}

export const playerNotesController = new Elysia({ prefix: "/player-notes" })
  .use(dbPlugin)
  .get("/", async ({ db, headers, query: params }) => {
    const auth = await access(db, headers, params.tournamentId);
    if (auth.error) return auth.error;
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(params.pageSize ?? 50)));
    let base: any = query(db);
    let count: any = db.selectFrom("player_note as note");
    if (params.targetId) { base = base.where("note.target_id", "=", params.targetId); count = count.where("note.target_id", "=", params.targetId); }
    if (params.tournamentId !== undefined) { base = base.where("note.tournament_id", "=", params.tournamentId); count = count.where("note.tournament_id", "=", params.tournamentId); }
    if (params.category) { base = base.where("note.category", "=", params.category); count = count.where("note.category", "=", params.category); }
    if (params.severity) { base = base.where("note.severity", "=", params.severity); count = count.where("note.severity", "=", params.severity); }
    if (params.resolved !== undefined) { base = base.where("note.resolved", "=", params.resolved); count = count.where("note.resolved", "=", params.resolved); }
    if (params.search?.trim()) { const term = `%${params.search.trim()}%`; base = base.where("note.content", "ilike", term); count = count.where("note.content", "ilike", term); }
    const [rows, totalRow] = await Promise.all([
      base.orderBy("note.created_at", "desc").limit(pageSize).offset((page - 1) * pageSize).execute(),
      count.select(({ fn }: any) => fn.countAll().as("count")).executeTakeFirst(),
    ]);
    const total = Number(totalRow?.count ?? 0);
    return { data: rows.map(dto), total, meta: { page, pageSize, pageCount: Math.ceil(total / pageSize), isStaff: auth.staff } };
  }, {
    query: t.Object({ targetId: t.Optional(t.String()), tournamentId: t.Optional(t.Numeric()), category: t.Optional(t.String()), severity: t.Optional(t.String()), resolved: t.Optional(t.Boolean()), search: t.Optional(t.String()), page: t.Optional(t.Numeric()), pageSize: t.Optional(t.Numeric()) }),
  })
  .get("/summary/:userId", async ({ db, headers, params: { userId } }) => {
    const auth = await access(db, headers);
    if (auth.error) return auth.error;
    const rows = await db.selectFrom("player_note").select(["severity", "resolved"]).where("target_id", "=", userId).execute();
    const bySeverity: Record<string, number> = { info: 0, warning: 0, serious: 0 };
    for (const row of rows) bySeverity[row.severity] = (bySeverity[row.severity] ?? 0) + 1;
    return { total: rows.length, open: rows.filter((row) => !row.resolved).length, bySeverity };
  }, { params: t.Object({ userId: t.String() }) })
  .post("/", async ({ db, headers, body }) => {
    const auth = await access(db, headers, body.tournamentId);
    if (auth.error) return auth.error;
    const content = body.content.trim();
    if (content.length < 3) return status(400, { message: "Note content is too short" as const });
    const target = await db.selectFrom("user").select("id").where("id", "=", body.targetId).executeTakeFirst();
    if (!target) return status(404, { message: "Player not found" as const });
    const row = await db.insertInto("player_note").values({ target_id: body.targetId, author_id: auth.session.id, tournament_id: body.tournamentId ?? null, category: body.category ?? "other", severity: body.severity ?? "info", content: content.slice(0, 2000), resolved: false, resolved_at: null, resolved_by_id: null }).returning("id").executeTakeFirstOrThrow();
    return dto(await query(db).where("note.id", "=", row.id).executeTakeFirstOrThrow());
  }, { body: t.Object({ targetId: t.String(), tournamentId: t.Optional(t.Nullable(t.Numeric())), category: t.Optional(t.String()), severity: t.Optional(t.String()), content: t.String() }) })
  .put("/:id", async ({ db, headers, params: { id }, body }) => {
    const auth = await access(db, headers);
    if (auth.error) return auth.error;
    const note = await db.selectFrom("player_note").select(["author_id"]).where("id", "=", id).executeTakeFirst();
    if (!note) return status(404, { message: "Note not found" as const });
    if (note.author_id !== auth.session.id && !auth.staff) return status(403, { message: "Note ownership required" as const });
    const values: Record<string, unknown> = { updated_at: new Date() };
    if (body.content !== undefined) values.content = body.content.trim().slice(0, 2000);
    if (body.category !== undefined) values.category = body.category;
    if (body.severity !== undefined) values.severity = body.severity;
    await db.updateTable("player_note").set(values).where("id", "=", id).execute();
    return dto(await query(db).where("note.id", "=", id).executeTakeFirstOrThrow());
  }, { params: t.Object({ id: t.String() }), body: t.Object({ content: t.Optional(t.String()), category: t.Optional(t.String()), severity: t.Optional(t.String()) }) })
  .post("/:id/:action", async ({ db, headers, params: { id, action } }) => {
    const auth = await access(db, headers);
    if (auth.error) return auth.error;
    if (action !== "resolve" && action !== "reopen") return status(404, { message: "Unknown action" as const });
    const exists = await db.selectFrom("player_note").select("id").where("id", "=", id).executeTakeFirst();
    if (!exists) return status(404, { message: "Note not found" as const });
    const resolved = action === "resolve";
    await db.updateTable("player_note").set({ resolved, resolved_at: resolved ? new Date() : null, resolved_by_id: resolved ? auth.session.id : null, updated_at: new Date() }).where("id", "=", id).execute();
    return dto(await query(db).where("note.id", "=", id).executeTakeFirstOrThrow());
  }, { params: t.Object({ id: t.String(), action: t.String() }) })
  .delete("/:id", async ({ db, headers, params: { id } }) => {
    const auth = await access(db, headers);
    if (auth.error) return auth.error;
    const note = await db.selectFrom("player_note").select(["id", "author_id"]).where("id", "=", id).executeTakeFirst();
    if (!note) return status(404, { message: "Note not found" as const });
    if (note.author_id !== auth.session.id && !auth.staff) return status(403, { message: "Note ownership required" as const });
    await db.deleteFrom("player_note").where("id", "=", id).execute();
    return { success: true as const };
  }, { params: t.Object({ id: t.String() }) });
