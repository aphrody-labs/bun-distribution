import { cached } from "../lib/cache";
import { sql } from "../lib/db";
import type {
  TeamMember,
  Profile,
  Chronicle,
  SearchHit,
  EventRow,
  PlanningRow,
  Article,
  DiscordMember,
} from "@rosegriffon/types";

const TEAM_CACHE_TTL_MS = 5 * 60_000;

export async function getTeam(teamId: "staff" | "association" | "partenaires", role?: string) {
  const cacheKey = role ? `team:${teamId}:role:${role.toLowerCase()}` : `team:${teamId}`;
  return await cached(cacheKey, TEAM_CACHE_TTL_MS, async () => {
    if (role) {
      return await sql<TeamMember[]>`
        SELECT name, role, image_url, member_link, team_id, team_name, discord_user_id
        FROM team_members
        WHERE team_id = ${teamId} AND is_active = true AND role ILIKE ${`%${role}%`}
        ORDER BY order_index, display_index NULLS LAST, name
      `;
    }
    return await sql<TeamMember[]>`
      SELECT name, role, image_url, member_link, team_id, team_name, discord_user_id
      FROM team_members
      WHERE team_id = ${teamId} AND is_active = true
      ORDER BY order_index, display_index NULLS LAST, name
    `;
  });
}

export async function getProfile(query: string) {
  const rows = await sql<Profile[]>`
    SELECT id, username, full_name, avatar_url, banner_url, bio, role, twitter_handle, website, discord_id
    FROM profiles
    WHERE username = ${query} OR discord_id = ${query} OR id::text = ${query}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Le pseudo du site d'un membre Discord — ou `null` s'il n'en a pas.
 *
 * ── POURQUOI PAS `getProfile()` ────────────────────────────────────────────
 * `getProfile()` trouve la ligne, mais ne dit RIEN de sa publication : la page
 * `/profil/<pseudo>` filtre sur `claimed_at IS NOT NULL` (un profil non réclamé
 * n'existe pas publiquement, c'est un fantôme d'import Discord). Un lien posé
 * sans cette condition mènerait donc à un 404 — et il le ferait pour la
 * majorité des membres, puisque 1 816 profils portent un `discord_id` quand
 * dix-neuf seulement ont été réclamés.
 *
 * Rend aussi `null` quand la lecture échoue : un profil Discord doit s'afficher
 * même si la base du site est indisponible, sans son bouton.
 */
export async function pseudoDuSite(discordId: string): Promise<string | null> {
  try {
    const rows = await sql<Array<{ username: string | null }>>`
      SELECT username
      FROM profiles
      WHERE discord_id = ${discordId} AND claimed_at IS NOT NULL AND username IS NOT NULL
      LIMIT 1
    `;
    return rows[0]?.username ?? null;
  } catch (err) {
    console.warn("[website] pseudo du site illisible :", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function listChronicles(category: string | null, limit: number) {
  if (category) {
    return await sql<Chronicle[]>`
      SELECT id, title, slug, excerpt, category, views_count, featured_image, created_at
      FROM chronicles
      WHERE published = true AND category = ${category}
      ORDER BY created_at DESC LIMIT ${limit}
    `;
  }
  return await sql<Chronicle[]>`
    SELECT id, title, slug, excerpt, category, views_count, featured_image, created_at
    FROM chronicles
    WHERE published = true
    ORDER BY created_at DESC LIMIT ${limit}
  `;
}

export async function readChronicle(slug: string) {
  const rows = await sql<Chronicle[]>`
    SELECT id, title, slug, excerpt, category, views_count, featured_image, created_at, content
    FROM chronicles
    WHERE slug = ${slug} AND published = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function searchAll(q: string) {
  return await sql<SearchHit[]>`
    SELECT 'article' AS kind, id::text, title::text AS title, slug::text AS slug, excerpt, app, COALESCE(published_at, created_at) AS created_at
    FROM articles
    WHERE status = 'published' AND (title ILIKE ${`%${q}%`} OR excerpt ILIKE ${`%${q}%`})
    UNION ALL
    SELECT 'chronique' AS kind, id::text, title, slug, excerpt, NULL AS app, created_at
    FROM chronicles
    WHERE published = true AND (title ILIKE ${`%${q}%`} OR excerpt ILIKE ${`%${q}%`})
    ORDER BY created_at DESC LIMIT 10
  `;
}

export async function nextEvents(count: number) {
  return await sql<EventRow[]>`
    SELECT id, title, description, start_time, end_time, location, image_url
    FROM events
    WHERE end_time >= NOW()
    ORDER BY start_time ASC LIMIT ${count}
  `;
}

export async function getPlanning(day: number | null) {
  if (day === null) {
    return await sql<PlanningRow[]>`
      SELECT day_of_week, streamer_name, start_time::text, end_time::text, category, notes
      FROM stream_schedules
      WHERE status = 'active'
      ORDER BY day_of_week, start_time
    `;
  }
  return await sql<PlanningRow[]>`
    SELECT day_of_week, streamer_name, start_time::text, end_time::text, category, notes
    FROM stream_schedules
    WHERE status = 'active' AND day_of_week = ${day}
    ORDER BY start_time
  `;
}

export type ArticleRow = Pick<
  Article,
  "id" | "title" | "slug" | "excerpt" | "category" | "featured_image_url" | "published_at" | "app"
>;

export async function azaleeLatest(limit: number, category?: string) {
  const max = Math.min(Math.max(limit, 1), 20);
  if (category) {
    return await sql<ArticleRow[]>`
      SELECT id, title::text, slug::text, excerpt, category::text, featured_image_url, published_at, app
      FROM articles
      WHERE status = 'published' AND app = 'azalee' AND category = ${category}
      ORDER BY published_at DESC NULLS LAST LIMIT ${max}
    `;
  }
  return await sql<ArticleRow[]>`
    SELECT id, title::text, slug::text, excerpt, category::text, featured_image_url, published_at, app
    FROM articles
    WHERE status = 'published' AND app = 'azalee'
    ORDER BY published_at DESC NULLS LAST LIMIT ${max}
  `;
}

export async function findMember(q: string) {
  return await sql<DiscordMember[]>`
    SELECT discord_id, username, display_name, nickname, avatar_url, roles, joined_at, is_bot
    FROM discord_members
    WHERE is_bot = false
      AND (username ILIKE ${`%${q}%`} OR display_name ILIKE ${`%${q}%`} OR nickname ILIKE ${`%${q}%`} OR discord_id = ${q})
    ORDER BY joined_at NULLS LAST LIMIT 10
  `;
}

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const rows = await sql<{ value: T }[]>`SELECT value FROM settings WHERE key = ${key} LIMIT 1`;
  return rows[0]?.value ?? null;
}
