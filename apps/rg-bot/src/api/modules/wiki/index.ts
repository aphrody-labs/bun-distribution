import { Elysia, status, t } from "elysia";
import { WikiModel } from "./model";
import { WikiService } from "./service";

export const wikiController = new Elysia({ prefix: "/wiki" })
  .get(
    "/characters",
    async ({ query }) => {
      return await WikiService.getCharacters(query);
    },
    {
      query: WikiModel.characterListQuery,
    },
  )
  .get(
    "/characters/:slug",
    async ({ params: { slug } }) => {
      const chara = await WikiService.getCharacter(slug);
      if (!chara) {
        return status(404, { error: "not_found", message: "Personnage introuvable" });
      }
      return chara;
    },
    {
      params: t.Object({ slug: t.String() }),
    },
  )
  .get(
    "/skills",
    async ({ query }) => {
      return await WikiService.getSkills(query);
    },
    {
      query: WikiModel.skillListQuery,
    },
  )
  .get(
    "/skills/:id",
    async ({ params: { id } }) => {
      const sk = await WikiService.getSkill(id);
      if (!sk) {
        return status(404, { error: "not_found", message: "Technique introuvable" });
      }
      return sk;
    },
    {
      params: t.Object({ id: t.String() }),
    },
  )
  .get("/teams", async () => {
    return await WikiService.getTeams();
  })
  .get(
    "/teams/:id",
    async ({ params: { id } }) => {
      const tm = await WikiService.getTeam(id);
      if (!tm) {
        return status(404, { error: "not_found", message: "Équipe introuvable" });
      }
      return tm;
    },
    {
      params: t.Object({ id: t.String() }),
    },
  )
  .get("/drops", async () => {
    return await WikiService.getDrops();
  })
  .get(
    "/text",
    async ({ query }) => {
      const q = query.q ?? "";
      const locale = query.locale ?? "fr";
      const limit = query.limit ?? 50;
      return await WikiService.searchText(q, locale, limit);
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        locale: t.Optional(t.String({ default: "fr" })),
        limit: t.Optional(t.Numeric({ default: 50 })),
      }),
    },
  )
  .get(
    "/text/:hash",
    async ({ params: { hash } }) => {
      const res = await WikiService.resolveText(hash);
      if (!res) {
        return status(404, { error: "not_found", message: "Texte introuvable" });
      }
      return res;
    },
    {
      params: t.Object({ hash: t.String() }),
    },
  )
  .get(
    "/cpk",
    async ({ query }) => {
      return await WikiService.listCpk(query.path, query.limit, query.offset);
    },
    {
      query: t.Object({
        path: t.Optional(t.String({ default: "" })),
        limit: t.Optional(t.Numeric({ default: 200 })),
        offset: t.Optional(t.Numeric({ default: 0 })),
      }),
    },
  )
  .get(
    "/cpk/search",
    async ({ query }) => {
      return await WikiService.searchCpk(query.q ?? "", query.limit);
    },
    {
      query: t.Object({
        q: t.Optional(t.String({ default: "" })),
        limit: t.Optional(t.Numeric({ default: 200 })),
      }),
    },
  );
