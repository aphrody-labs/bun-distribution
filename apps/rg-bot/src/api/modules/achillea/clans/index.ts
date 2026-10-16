import { Elysia, status, t } from "elysia";
import { dbPlugin } from "../../../plugins/db";
import { ClanModel } from "./model";
import { ClanService } from "./service";
import { resolveAchilleaSession } from "../../auth/session";
import { verifyAdminBearerToken } from "@rosegriffon/achillea-core/auth";

export const clanController = new Elysia({ prefix: "/clans" })
  .use(dbPlugin)
  .post(
    "/validate/name",
    async ({ db, headers, body, set }) => {
      const bearer = headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!verifyAdminBearerToken(bearer, process.env.API_ADMIN_TOKEN)) {
        set.status = 401;
        return { message: "Internal authentication required" as const };
      }
      return ClanService.validateName(db, body.name);
    },
    {
      body: t.Object({ name: t.String() }),
      response: {
        200: ClanModel.validation,
        401: t.Object({ message: t.Literal("Internal authentication required") }),
      },
    },
  )
  .post(
    "/validate/short-name",
    async ({ db, headers, body, set }) => {
      const bearer = headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!verifyAdminBearerToken(bearer, process.env.API_ADMIN_TOKEN)) {
        set.status = 401;
        return { message: "Internal authentication required" as const };
      }
      return ClanService.validateShortName(db, body.shortName);
    },
    {
      body: t.Object({ shortName: t.String() }),
      response: {
        200: ClanModel.validation,
        401: t.Object({ message: t.Literal("Internal authentication required") }),
      },
    },
  )
  .get(
    "/me",
    async ({ db, headers }) => {
      const session = await resolveAchilleaSession(headers);
      if (!session) return status(401, { message: "Authentication required" as const });
      const membership = await db
        .selectFrom("clan_member as cm")
        .innerJoin("clan as c", "c.id", "cm.clan_id")
        .select("cm.clan_id")
        .where("cm.user_id", "=", session.id)
        .where("c.is_inactive", "=", false)
        .where("c.is_disbanded", "=", false)
        .executeTakeFirst();
      return { clanId: membership?.clan_id ?? null };
    },
    {
      response: {
        200: t.Object({ clanId: t.Nullable(t.Number()) }),
        401: t.Object({ message: t.Literal("Authentication required") }),
      },
    },
  )
  .get(
    "/",
    async ({ db, query }) => {
      return await ClanService.findAll(db, query.page, query.pageSize);
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric({ minimum: 1 })),
        pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
        state: t.Optional(t.Numeric()),
      }),
      response: {
        200: ClanModel.listResponse,
      },
    },
  )
  .get(
    "/invites",
    async ({ db, headers }) => {
      const session = await resolveAchilleaSession(headers);
      if (!session) return status(401, { message: "Authentication required" as const });
      const result = await ClanService.listInvitesForManager(db, session.id);
      if (!result.ok) return status(result.status, { message: result.message });
      return result.data;
    },
    {
      response: {
        200: t.Array(ClanModel.invite),
        401: t.Object({ message: t.String() }),
        403: t.Object({ message: t.String() }),
      },
    },
  )
  .get(
    "/applications",
    async ({ db, headers }) => {
      const session = await resolveAchilleaSession(headers);
      if (!session) return status(401, { message: "Authentication required" as const });
      const result = await ClanService.listApplicationsForManager(db, session.id);
      if (!result.ok) return status(result.status, { message: result.message });
      return result.data;
    },
    {
      response: {
        200: t.Array(ClanModel.application),
        401: t.Object({ message: t.String() }),
        403: t.Object({ message: t.String() }),
      },
    },
  )
  .patch(
    "/:id",
    async ({ db, headers, params, body, set }) => {
      const session = await resolveAchilleaSession(headers);
      if (!session) return status(401, { message: "Authentication required" as const });
      const result = await ClanService.update(db, params.id, session.id, body);
      if (!result.ok) return status(result.status as 400 | 401 | 403 | 404, { message: result.message });
      return { success: true as const, previousName: result.previousName, roleId: result.roleId, clan: result.clan };
    },
    {
      params: t.Object({ id: t.Numeric() }),
      body: ClanModel.updateBody,
      response: {
        200: ClanModel.updateResponse,
        400: t.Object({ message: t.String() }),
        401: t.Object({ message: t.String() }),
        403: t.Object({ message: t.String() }),
        404: t.Object({ message: t.String() }),
      },
    },
  )
  .get(
    "/:id",
    async ({ db, params: { id } }) => {
      const item = await ClanService.findById(db, id);
      if (!item) {
        return status(404, { message: "Clan not found" as const });
      }
      return item;
    },
    {
      params: t.Object({
        id: t.Numeric(),
      }),
      response: {
        200: ClanModel.clan,
        404: ClanModel.notFound,
      },
    },
  )
  .get(
    "/:id/members",
    async ({ db, params: { id } }) => {
      const rows = await db
        .selectFrom("clan_member as cm")
        .innerJoin("user as u", "u.id", "cm.user_id")
        .select([
          "cm.clan_id",
          "cm.user_id",
          "cm.created_at",
          "cm.updated_at",
          "cm.clan_fame_contributed",
          "cm.role",
          "cm.distinctions",
          "u.display_name",
          "u.username",
          "u.avatar",
          "u.role as user_role",
        ])
        .where("cm.clan_id", "=", id)
        .orderBy("cm.role", "asc")
        .execute();
      return rows.map(row => ({
        clanRole: Number(row.role),
        distinctions: row.distinctions ?? [],
        clanFameContributed: Number(row.clan_fame_contributed ?? 0),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        user: {
          id: row.user_id,
          type: "user" as const,
          username: row.display_name ?? row.username ?? row.user_id,
          avatar: row.avatar?.startsWith("http")
            ? row.avatar
            : `https://cdn.discordapp.com/embed/avatars/${(BigInt(row.user_id) >> 22n) % 6n}.png`,
          clanId: row.clan_id,
          role: Number(row.user_role ?? 0),
        },
      }));
    },
    { params: t.Object({ id: t.Numeric() }), response: { 200: ClanModel.members } },
  );
