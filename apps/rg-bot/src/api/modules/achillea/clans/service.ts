import type { Kysely } from "kysely";
import type { Database } from "@rosegriffon/db/schema";
import { normalizeNames, resolveDiscordAvatarUrl } from "@rosegriffon/achillea-core";
import type { ClanDTO } from "./model";

const CLAN_MANAGER_ROLE = 2;

type ClanUpdate = {
  name?: string;
  shortenedName?: string;
  clanBiography?: string;
  clanAvatarUrl?: string;
  xUrl?: string | null;
  instagramUrl?: string | null;
  tiktokUrl?: string | null;
  isRecruiting?: boolean;
  autoAcceptMembers?: boolean;
  isInactive?: boolean;
};

function socialUrl(value: string, platform: "x" | "instagram" | "tiktok"): string | null {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^www\./, "");
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 1) return null;
    let username = parts[0];
    if (!username) return null;
    const matches = platform === "x" ? host === "x.com" || host === "twitter.com" : host === `${platform}.com`;
    if (!matches) return null;
    if (platform === "tiktok") username = username.replace(/^@/, "");
    if (!/^[\w.-]{1,30}$/.test(username)) return null;
    return platform === "x"
      ? `https://x.com/${username}`
      : platform === "tiktok"
        ? `https://tiktok.com/@${username}`
        : `https://instagram.com/${username}`;
  } catch {
    return null;
  }
}

export abstract class ClanService {
  private static user(
    row: { id: string; display_name: string; username: string | null; avatar: string | null; role: number },
    clanId: number | null,
  ) {
    return {
      id: row.id,
      type: "user" as const,
      username: row.display_name || row.username || row.id,
      avatar: resolveDiscordAvatarUrl(row.id, row.avatar),
      clanId,
      role: Number(row.role ?? 0),
    };
  }

  private static async managedClanId(db: Kysely<Database>, actorId: string) {
    const membership = await db
      .selectFrom("clan_member")
      .select(["clan_id", "role"])
      .where("user_id", "=", actorId)
      .executeTakeFirst();
    if (!membership) return { ok: false as const, status: 403 as const, message: "Vous n'êtes pas dans un clan" };
    if (Number(membership.role) < CLAN_MANAGER_ROLE) {
      return {
        ok: false as const,
        status: 403 as const,
        message: "Vous n'avez pas les droits pour effectuer cette action",
      };
    }
    return { ok: true as const, clanId: membership.clan_id };
  }

  private static async clanProjection(db: Kysely<Database>, clanId: number) {
    const [clan, experience, captain, count] = await Promise.all([
      db.selectFrom("clan").selectAll().where("id", "=", clanId).executeTakeFirstOrThrow(),
      db
        .selectFrom("clan_experience")
        .select(["current_level", "total_xp"])
        .where("clan_id", "=", clanId)
        .executeTakeFirst(),
      db
        .selectFrom("clan_member as cm")
        .innerJoin("user as u", "u.id", "cm.user_id")
        .select(["u.id", "u.display_name", "u.username", "u.avatar", "u.role"])
        .where("cm.clan_id", "=", clanId)
        .where("cm.role", "=", 3)
        .executeTakeFirst(),
      db
        .selectFrom("clan_member")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("clan_id", "=", clanId)
        .executeTakeFirstOrThrow(),
    ]);
    const fallbackId = clan.founders[0] ?? "0";
    return {
      id: clan.id,
      founders: clan.founders,
      name: clan.name,
      shortenedName: clan.shortened_name,
      normalizedShortName: clan.normalized_short_name,
      clanAvatarUrl: clan.clan_avatar_url,
      clanBiography: clan.clan_biography,
      fame: Number(clan.clan_fame),
      xUrl: clan.x_url,
      instagramUrl: clan.instagram_url,
      tiktokUrl: clan.tiktok_url,
      isRecruiting: Boolean(clan.is_recruiting),
      isInactive: Boolean(clan.is_inactive),
      isHidden: Boolean(clan.is_hidden),
      isDisbanded: Boolean(clan.is_disbanded),
      autoAcceptMembers: Boolean(clan.auto_accept_members),
      state: Number(clan.state),
      createdAt: clan.created_at,
      languages: clan.languages ?? [],
      origin: clan.origin ?? "",
      experience: { currentLevel: Number(experience?.current_level ?? 0), totalXp: Number(experience?.total_xp ?? 0) },
      membersCount: Number(count.count),
      president: captain
        ? this.user(captain, clanId)
        : {
            id: fallbackId,
            type: "user" as const,
            username: clan.name,
            avatar: resolveDiscordAvatarUrl(fallbackId, null),
            clanId,
            role: 0,
          },
    };
  }

  private static async users(db: Kysely<Database>, ids: string[]) {
    if (ids.length === 0) return new Map<string, ReturnType<typeof ClanService.user>>();
    const rows = await db
      .selectFrom("user")
      .select(["id", "display_name", "username", "avatar", "role"])
      .where("id", "in", [...new Set(ids)])
      .execute();
    return new Map(rows.map(row => [row.id, ClanService.user(row, null)]));
  }

  public static async listInvitesForManager(db: Kysely<Database>, actorId: string) {
    const access = await ClanService.managedClanId(db, actorId);
    if (!access.ok) return access;
    const invitations = await db
      .selectFrom("clan_invite")
      .selectAll()
      .where("clan_id", "=", access.clanId)
      .orderBy("created_at", "asc")
      .execute();
    const inviterIds = [...new Set(invitations.map(invite => invite.inviter_id))];
    const [clan, users, members, histories] = await Promise.all([
      ClanService.clanProjection(db, access.clanId),
      ClanService.users(
        db,
        invitations.flatMap(invite => [invite.user_id, invite.inviter_id]),
      ),
      inviterIds.length
        ? db
            .selectFrom("clan_member")
            .selectAll()
            .where("clan_id", "=", access.clanId)
            .where("user_id", "in", inviterIds)
            .execute()
        : [],
      inviterIds.length
        ? db
            .selectFrom("clan_member_history")
            .selectAll()
            .where("clan_id", "=", access.clanId)
            .where("user_id", "in", inviterIds)
            .orderBy("created_at", "desc")
            .execute()
        : [],
    ]);
    const memberByUser = new Map(members.map(member => [member.user_id, member]));
    const historyByUser = new Map<string, (typeof histories)[number]>();
    for (const history of histories)
      if (!historyByUser.has(history.user_id)) historyByUser.set(history.user_id, history);
    return {
      ok: true as const,
      data: invitations.flatMap(invite => {
        const target = users.get(invite.user_id);
        const inviter = users.get(invite.inviter_id);
        const membership = memberByUser.get(invite.inviter_id) ?? historyByUser.get(invite.inviter_id);
        if (!target || !inviter || !membership) return [];
        return [
          {
            id: invite.id,
            user: target,
            clan,
            inviter: {
              clanRole: Number(membership.role),
              distinctions: "distinctions" in membership ? (membership.distinctions ?? []) : [],
              clanFameContributed: Number(membership.clan_fame_contributed ?? 0),
              createdAt: membership.created_at,
              updatedAt: membership.updated_at,
              user: { ...inviter, clanId: access.clanId },
            },
            ...(invite.thread_id ? { threadId: invite.thread_id } : {}),
            distinctions: invite.distinctions ?? [],
            createdAt: invite.created_at,
            updatedAt: invite.updated_at,
            lastNotifiedAt: invite.last_notified_at,
          },
        ];
      }),
    };
  }

  public static async listApplicationsForManager(db: Kysely<Database>, actorId: string) {
    const access = await ClanService.managedClanId(db, actorId);
    if (!access.ok) return access;
    const applications = await db
      .selectFrom("clan_application")
      .selectAll()
      .where("clan_id", "=", access.clanId)
      .orderBy("created_at", "asc")
      .execute();
    const [clan, users] = await Promise.all([
      ClanService.clanProjection(db, access.clanId),
      ClanService.users(
        db,
        applications.map(application => application.user_id),
      ),
    ]);
    return {
      ok: true as const,
      data: applications.flatMap(application => {
        const user = users.get(application.user_id);
        return user
          ? [
              {
                id: application.id,
                user,
                clan,
                distinctions: application.distinctions ?? [],
                createdAt: application.created_at,
                updatedAt: application.updated_at,
              },
            ]
          : [];
      }),
    };
  }

  private static graphemeCount(value: string): number {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)).length;
  }

  public static async validateName(db: Kysely<Database>, name: string) {
    const normalizedName = normalizeNames(name);
    if (this.graphemeCount(name) < 3 || this.graphemeCount(name) > 30 || !normalizedName) {
      return { valid: false as const, code: "INVALID_NAME" as const };
    }
    const duplicate = await db
      .selectFrom("clan")
      .select("id")
      .where("normalized_name", "=", normalizedName)
      .executeTakeFirst();
    return duplicate ? { valid: false as const, code: "NAME_TAKEN" as const } : { valid: true as const };
  }

  public static async validateShortName(db: Kysely<Database>, shortName: string) {
    const normalizedShortName = normalizeNames(shortName);
    if (
      this.graphemeCount(shortName) < 2 ||
      this.graphemeCount(shortName) > 3 ||
      !normalizedShortName ||
      !/^[^\s]+$/.test(normalizedShortName)
    ) {
      return { valid: false as const, code: "INVALID_SHORTNAME" as const };
    }
    const duplicate = await db
      .selectFrom("clan")
      .select("id")
      .where("normalized_short_name", "=", normalizedShortName)
      .executeTakeFirst();
    return duplicate ? { valid: false as const, code: "SHORTNAME_TAKEN" as const } : { valid: true as const };
  }

  public static async update(db: Kysely<Database>, clanId: number, actorId: string, patch: ClanUpdate) {
    const result = await db.transaction().execute(async trx => {
      const actor = await trx.selectFrom("user").select("role").where("id", "=", actorId).executeTakeFirst();
      if (!actor) return { ok: false as const, status: 401, message: "Authentication required" };
      const clan = await trx.selectFrom("clan").selectAll().where("id", "=", clanId).forUpdate().executeTakeFirst();
      if (!clan) return { ok: false as const, status: 404, message: "Clan not found" };
      const membership = await trx
        .selectFrom("clan_member")
        .select("role")
        .where("clan_id", "=", clanId)
        .where("user_id", "=", actorId)
        .executeTakeFirst();
      const isAdmin = Number(actor.role ?? 0) >= 2;
      if (!isAdmin && (!membership || Number(membership.role) < 3))
        return { ok: false as const, status: 403, message: "Reserved for clan captain or administrator" };
      if (!isAdmin && patch.isInactive !== undefined)
        return { ok: false as const, status: 403, message: "Only administrators can change inactivity" };

      let name = clan.name;
      let normalizedName = clan.normalized_name;
      if (patch.name !== undefined && patch.name !== clan.name) {
        const validation = await this.validateName(trx, patch.name);
        if (!validation.valid)
          return {
            ok: false as const,
            status: 400,
            message:
              validation.code === "NAME_TAKEN" ? "Ce nom de clan est déjà pris." : "Nom invalide (3 à 30 caractères).",
          };
        name = patch.name;
        normalizedName = normalizeNames(patch.name);
      }
      let shortenedName = clan.shortened_name;
      let normalizedShortName = clan.normalized_short_name;
      if (patch.shortenedName !== undefined && patch.shortenedName !== clan.shortened_name) {
        const validation = await this.validateShortName(trx, patch.shortenedName);
        if (!validation.valid)
          return {
            ok: false as const,
            status: 400,
            message:
              validation.code === "SHORTNAME_TAKEN"
                ? "Ce tag de clan est déjà pris."
                : "Tag invalide (2 à 3 caractères, sans espace).",
          };
        shortenedName = patch.shortenedName;
        normalizedShortName = normalizeNames(patch.shortenedName);
      }
      if (patch.clanBiography !== undefined && patch.clanBiography.length > 1500)
        return { ok: false as const, status: 400, message: "Biographie trop longue (1500 caractères max)." };
      let avatarUrl = clan.clan_avatar_url;
      if (patch.clanAvatarUrl !== undefined && patch.clanAvatarUrl !== clan.clan_avatar_url) {
        if (!patch.clanAvatarUrl) return { ok: false as const, status: 400, message: "Logo invalide." };
        const duplicate = await trx
          .selectFrom("clan")
          .select("id")
          .where("clan_avatar_url", "=", patch.clanAvatarUrl)
          .where("id", "!=", clanId)
          .executeTakeFirst();
        if (duplicate)
          return { ok: false as const, status: 400, message: "Cette image est déjà utilisée par un autre clan." };
        avatarUrl = patch.clanAvatarUrl;
      }
      const social = (
        value: string | null | undefined,
        platform: "x" | "instagram" | "tiktok",
        current: string | null,
      ) => {
        if (value === undefined) return current;
        const input = value ?? "";
        if (!input.trim()) return null;
        const canonical = socialUrl(input, platform);
        if (!canonical) throw new Error(`Lien ${platform === "x" ? "X/Twitter" : platform} invalide.`);
        return canonical;
      };
      let xUrl: string | null;
      let instagramUrl: string | null;
      let tiktokUrl: string | null;
      try {
        xUrl = social(patch.xUrl, "x", clan.x_url);
        instagramUrl = social(patch.instagramUrl, "instagram", clan.instagram_url);
        tiktokUrl = social(patch.tiktokUrl, "tiktok", clan.tiktok_url);
      } catch (error) {
        return {
          ok: false as const,
          status: 400,
          message: error instanceof Error ? error.message : "Lien social invalide.",
        };
      }
      const updated = await trx
        .updateTable("clan")
        .set({
          name,
          normalized_name: normalizedName,
          shortened_name: shortenedName,
          normalized_short_name: normalizedShortName,
          clan_biography: patch.clanBiography ?? clan.clan_biography,
          clan_avatar_url: avatarUrl,
          x_url: xUrl,
          instagram_url: instagramUrl,
          tiktok_url: tiktokUrl,
          is_recruiting: patch.isRecruiting ?? clan.is_recruiting,
          auto_accept_members: patch.autoAcceptMembers ?? clan.auto_accept_members,
          is_inactive: patch.isInactive ?? clan.is_inactive,
          updated_at: new Date(),
        })
        .where("id", "=", clanId)
        .returningAll()
        .executeTakeFirstOrThrow();
      return {
        ok: true as const,
        previousName: clan.name,
        roleId: clan.role_id,
        clan: {
          id: updated.id,
          name: updated.name,
          shortName: updated.shortened_name,
          avatarUrl: updated.clan_avatar_url,
          biography: updated.clan_biography,
          fame: updated.clan_fame,
          isRecruiting: Boolean(updated.is_recruiting),
          membersLimit: Boolean(updated.under_member_limit),
        },
      };
    });
    return result;
  }

  public static async findAll(
    db: Kysely<Database>,
    page = 1,
    pageSize = 50,
  ): Promise<{ data: ClanDTO[]; count: number }> {
    const base = db.selectFrom("clan").selectAll().where("is_disbanded", "=", false).where("is_hidden", "=", false);
    const [rows, countRow] = await Promise.all([
      base
        .orderBy("clan_fame", "desc")
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .execute(),
      db
        .selectFrom("clan")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("is_disbanded", "=", false)
        .where("is_hidden", "=", false)
        .executeTakeFirst(),
    ]);

    const data: ClanDTO[] = rows.map(r => ({
      id: r.id,
      name: r.name,
      shortName: r.shortened_name,
      avatarUrl: r.clan_avatar_url,
      biography: r.clan_biography,
      fame: r.clan_fame,
      isRecruiting: Boolean(r.is_recruiting),
      membersLimit: Boolean(r.under_member_limit),
    }));

    return { data, count: Number(countRow?.count ?? data.length) };
  }

  public static async findById(db: Kysely<Database>, id: number): Promise<ClanDTO | null> {
    const r = await db
      .selectFrom("clan")
      .selectAll()
      .where("id", "=", id)
      .where("is_disbanded", "=", false)
      .where("is_hidden", "=", false)
      .executeTakeFirst();

    if (!r) return null;

    return {
      id: r.id,
      name: r.name,
      shortName: r.shortened_name,
      avatarUrl: r.clan_avatar_url,
      biography: r.clan_biography,
      fame: r.clan_fame,
      isRecruiting: Boolean(r.is_recruiting),
      membersLimit: Boolean(r.under_member_limit),
    };
  }
}
