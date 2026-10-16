import { Elysia, status, t } from "elysia";
import { InagleRepository } from "./repository";
import { inagleDb } from "../../plugins/db";

const repository = new InagleRepository(inagleDb);

const listQuery = t.Object({
  q: t.Optional(t.String()),
  limit: t.Optional(t.Numeric({ default: 50, minimum: 1, maximum: 500 })),
});

/**
 * Inagle's parser/database boundary exposed through the unified API.
 * PostgreSQL/Kysely is the only HTTP source. Extraction and offline mirrors
 * stay behind the CLI boundary and are never silently used by this API.
 */
export const inagleModule = new Elysia({ prefix: "/inagle" })
  .get("/health", () => ({ ok: true, service: "inagle" }))
  .get(
    "/teams",
    async ({ query }) => {
      const data = (await repository.teams(query.q, query.limit ?? 50)) ?? [];
      return { data, count: data.length, source: "postgres" as const };
    },
    { query: listQuery },
  )
  .get(
    "/teams/:id",
    ({ params }) => {
      return repository.team(params.id).then(dbData => {
        return dbData ?? status(404, { error: "not_found", message: "Équipe introuvable" });
      });
    },
    { params: t.Object({ id: t.String() }) },
  )
  .get(
    "/formations",
    async ({ query }) => {
      const data = (await repository.formations(query.q, query.limit ?? 50)) ?? [];
      return { data, count: data.length, source: "postgres" as const };
    },
    { query: listQuery },
  )
  .get(
    "/formations/:id",
    async ({ params }) => {
      const dbData = await repository.formation(params.id);
      return dbData ?? status(404, { error: "not_found", message: "Formation introuvable" });
    },
    { params: t.Object({ id: t.String() }) },
  )
  .get(
    "/souls",
    async ({ query }) => ({
      data: (await repository.souls(query.q, query.limit ?? 50)) ?? [],
    }),
    { query: listQuery },
  )
  .get(
    "/souls/:id",
    async ({ params }) => {
      const data = await repository.soul(params.id);
      return data ?? status(404, { error: "not_found", message: "Esprit introuvable" });
    },
    { params: t.Object({ id: t.String() }) },
  )
  .get(
    "/quests",
    ({ query }) => {
      const phase = query.phase === undefined ? undefined : Number(query.phase);
      return repository.quests(query.q, phase, query.limit ?? 50).then(dbData => ({
        data: dbData ?? [],
        count: dbData?.length ?? 0,
        source: "postgres" as const,
      }));
    },
    { query: t.Object({ ...listQuery.properties, phase: t.Optional(t.Numeric()) }) },
  )
  .get(
    "/quests/:id",
    ({ params }) => {
      return repository.quest(params.id).then(dbData => {
        return dbData ?? status(404, { error: "not_found", message: "Quête introuvable" });
      });
    },
    { params: t.Object({ id: t.String() }) },
  )
  .get(
    "/items",
    async ({ query }) => {
      const data = (await repository.items(query.q, query.category, query.limit ?? 50)) ?? [];
      return { data, count: data.length, source: "postgres" as const };
    },
    { query: t.Object({ ...listQuery.properties, category: t.Optional(t.String()) }) },
  )
  .get(
    "/items/:id",
    async ({ params }) => {
      const dbData = await repository.item(params.id);
      return dbData ?? status(404, { error: "not_found", message: "Objet introuvable" });
    },
    { params: t.Object({ id: t.String() }) },
  )
  .get(
    "/drops/table/:id",
    async ({ params }) => ({
      data: (await repository.dropTable(params.id))?.entries ?? [],
    }),
    {
      params: t.Object({ id: t.String() }),
    },
  )
  .get(
    "/drops/item/:id",
    async ({ params }) => ({
      data: (await repository.dropSources(params.id)) ?? [],
    }),
    {
      params: t.Object({ id: t.String() }),
    },
  )
  .get(
    "/drops/battle/:id",
    async ({ params }) => ({
      data: (await repository.battleDrops(Number(params.id))) ?? [],
    }),
    {
      params: t.Object({ id: t.Numeric() }),
    },
  )
  .get(
    "/skill-cutins/:id",
    async ({ params }) => {
      const row = await repository.skillCutin(params.id);
      return row ?? status(404, { error: "not_found", message: "Cut-in introuvable" });
    },
    { params: t.Object({ id: t.String() }) },
  )
  .get(
    "/skill-cutins/assets/:eventIdName",
    async ({ params }) => ({
      available: Boolean(await repository.skillCutinAssets(params.eventIdName)),
    }),
    { params: t.Object({ eventIdName: t.String() }) },
  );
