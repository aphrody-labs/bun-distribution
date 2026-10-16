import { cached, invalidate } from "../lib/cache";
import { sql } from "../lib/db";

const STATS_CACHE_TTL_MS = 30_000;
const SETTINGS_CACHE_TTL_MS = 60_000;
const STATS_KEY = "stats:admin";
const SETTINGS_KEY = "settings:list";

function bustStats() {
	invalidate(STATS_KEY);
}

// ─── Dashboard stats ────────────────────────────────────────────────────

export interface AdminStats {
	profiles_total: number;
	profiles_24h: number;
	admins: number;
	banned: number;
	articles_published: number;
	articles_draft: number;
	events_upcoming: number;
	events_past: number;
	team_members: number;
	discord_members: number;
}

export async function getAdminStats(): Promise<AdminStats> {
	return await cached(STATS_KEY, STATS_CACHE_TTL_MS, async () => {
		const [row] = await sql<AdminStats[]>`
      SELECT
        (SELECT count(*) FROM profiles)::int                                              AS profiles_total,
        (SELECT count(*) FROM profiles WHERE updated_at >= NOW() - INTERVAL '24 hours')::int AS profiles_24h,
        (SELECT count(*) FROM profiles WHERE role = 'admin')::int                         AS admins,
        (SELECT count(*) FROM profiles WHERE role = 'banned')::int                        AS banned,
        (SELECT count(*) FROM articles WHERE status = 'published')::int                   AS articles_published,
        (SELECT count(*) FROM articles WHERE status = 'draft')::int                       AS articles_draft,
        (SELECT count(*) FROM events WHERE end_time >= NOW())::int                        AS events_upcoming,
        (SELECT count(*) FROM events WHERE end_time <  NOW())::int                        AS events_past,
        (SELECT count(*) FROM team_members WHERE is_active = true)::int                   AS team_members,
        (SELECT count(*) FROM discord_members WHERE is_bot = false)::int                  AS discord_members
    `;
		return row!;
	});
}

// ─── User management ────────────────────────────────────────────────────

export interface AdminUserRow {
	id: string;
	username: string | null;
	full_name: string | null;
	email: string | null;
	role: string | null;
	avatar_url: string | null;
	discord_id: string | null;
	updated_at: Date | null;
}

export async function listUsers(query: string | null, role: string | null, limit = 20) {
	const max = Math.min(Math.max(limit, 1), 50);
	if (query && role) {
		return await sql<AdminUserRow[]>`
      SELECT id, username, full_name, email, role, avatar_url, discord_id, updated_at
      FROM profiles
      WHERE role = ${role}
        AND (username ILIKE ${`%${query}%`} OR full_name ILIKE ${`%${query}%`} OR email ILIKE ${`%${query}%`} OR discord_id = ${query})
      ORDER BY updated_at DESC NULLS LAST LIMIT ${max}
    `;
	}
	if (query) {
		return await sql<AdminUserRow[]>`
      SELECT id, username, full_name, email, role, avatar_url, discord_id, updated_at
      FROM profiles
      WHERE username ILIKE ${`%${query}%`} OR full_name ILIKE ${`%${query}%`} OR email ILIKE ${`%${query}%`} OR discord_id = ${query}
      ORDER BY updated_at DESC NULLS LAST LIMIT ${max}
    `;
	}
	if (role) {
		return await sql<AdminUserRow[]>`
      SELECT id, username, full_name, email, role, avatar_url, discord_id, updated_at
      FROM profiles
      WHERE role = ${role}
      ORDER BY updated_at DESC NULLS LAST LIMIT ${max}
    `;
	}
	return await sql<AdminUserRow[]>`
    SELECT id, username, full_name, email, role, avatar_url, discord_id, updated_at
    FROM profiles
    ORDER BY updated_at DESC NULLS LAST LIMIT ${max}
  `;
}

export async function getUserById(id: string): Promise<AdminUserRow | null> {
	const rows = await sql<AdminUserRow[]>`
    SELECT id, username, full_name, email, role, avatar_url, discord_id, updated_at
    FROM profiles WHERE id = ${id} LIMIT 1
  `;
	return rows[0] ?? null;
}

export async function getUserByDiscord(discordId: string): Promise<AdminUserRow | null> {
	const rows = await sql<AdminUserRow[]>`
    SELECT p.id, p.username, p.full_name, p.email, p.role, p.avatar_url, p.discord_id, p.updated_at
    FROM account a
    JOIN profiles p ON p.id::text = a.user_id
    WHERE a.provider_id = 'discord' AND a.account_id = ${discordId}
    LIMIT 1
  `;
	return rows[0] ?? null;
}

export async function setUserRole(id: string, role: string) {
	await sql`UPDATE profiles SET role = ${role}, updated_at = NOW() WHERE id = ${id}`;
	bustStats();
}

// ─── Chronicle / article admin ──────────────────────────────────────────

export interface AdminArticle {
	id: string;
	title: string;
	slug: string;
	status: string;
	category: string | null;
	app: string;
	excerpt: string | null;
	featured_image_url: string | null;
	published_at: Date | null;
	updated_at: Date;
	view_count: number;
}

export async function listArticlesAdmin(status: string | null, limit = 10) {
	const max = Math.min(Math.max(limit, 1), 25);
	if (status) {
		return await sql<AdminArticle[]>`
      SELECT id, title::text, slug::text, status::text, category::text, app, excerpt,
             featured_image_url, published_at, updated_at, view_count
      FROM articles
      WHERE status = ${status}
      ORDER BY updated_at DESC LIMIT ${max}
    `;
	}
	return await sql<AdminArticle[]>`
    SELECT id, title::text, slug::text, status::text, category::text, app, excerpt,
           featured_image_url, published_at, updated_at, view_count
    FROM articles
    ORDER BY updated_at DESC LIMIT ${max}
  `;
}

export async function setArticleStatus(id: string, status: "published" | "draft" | "archived") {
	const publishedAt = status === "published" ? new Date() : null;
	await sql`
    UPDATE articles
    SET status = ${status}, updated_at = NOW(),
        published_at = COALESCE(${publishedAt}, published_at)
    WHERE id = ${id}
  `;
	bustStats();
}

export async function deleteArticle(id: string) {
	await sql`DELETE FROM articles WHERE id = ${id}`;
	bustStats();
}

// ─── Events admin ───────────────────────────────────────────────────────

export interface AdminEvent {
	id: string;
	title: string;
	description: string | null;
	start_time: Date;
	end_time: Date;
	location: string | null;
	image_url: string | null;
	updated_at: Date;
}

export async function listEventsAdmin(scope: "upcoming" | "past" | "all", limit = 10) {
	const max = Math.min(Math.max(limit, 1), 25);
	if (scope === "upcoming") {
		return await sql<AdminEvent[]>`
      SELECT id, title, description, start_time, end_time, location, image_url, updated_at
      FROM events WHERE end_time >= NOW()
      ORDER BY start_time ASC LIMIT ${max}
    `;
	}
	if (scope === "past") {
		return await sql<AdminEvent[]>`
      SELECT id, title, description, start_time, end_time, location, image_url, updated_at
      FROM events WHERE end_time < NOW()
      ORDER BY start_time DESC LIMIT ${max}
    `;
	}
	return await sql<AdminEvent[]>`
    SELECT id, title, description, start_time, end_time, location, image_url, updated_at
    FROM events ORDER BY start_time DESC LIMIT ${max}
  `;
}

export async function createEvent(input: {
	title: string;
	description?: string | null;
	start_time: Date;
	end_time: Date;
	location?: string | null;
	image_url?: string | null;
}) {
	const rows = await sql<{ id: string }[]>`
    INSERT INTO events (title, description, start_time, end_time, location, image_url)
    VALUES (${input.title}, ${input.description ?? null}, ${input.start_time}, ${input.end_time},
            ${input.location ?? null}, ${input.image_url ?? null})
    RETURNING id
  `;
	return rows[0]!.id;
}

export async function updateEvent(
	id: string,
	patch: Partial<{
		title: string;
		description: string | null;
		start_time: Date;
		end_time: Date;
		location: string | null;
		image_url: string | null;
	}>
) {
	await sql`
    UPDATE events SET
      title = COALESCE(${patch.title ?? null}, title),
      description = COALESCE(${patch.description ?? null}, description),
      start_time = COALESCE(${patch.start_time ?? null}, start_time),
      end_time = COALESCE(${patch.end_time ?? null}, end_time),
      location = COALESCE(${patch.location ?? null}, location),
      image_url = COALESCE(${patch.image_url ?? null}, image_url),
      updated_at = NOW()
    WHERE id = ${id}
  `;
}

export async function deleteEvent(id: string) {
	await sql`DELETE FROM events WHERE id = ${id}`;
	bustStats();
}

// ─── Stream schedule admin ──────────────────────────────────────────────

export interface AdminStreamRow {
	id: string;
	day_of_week: number;
	streamer_name: string;
	start_time: string | null;
	end_time: string | null;
	category: string | null;
	status: string;
	notes: string | null;
}

export async function listStreamsAdmin() {
	return await sql<AdminStreamRow[]>`
    SELECT id, day_of_week, streamer_name, start_time::text, end_time::text, category, status, notes
    FROM stream_schedules
    ORDER BY day_of_week, start_time
  `;
}

export async function addStream(input: {
	day_of_week: number;
	streamer_name: string;
	start_time?: string | null;
	end_time?: string | null;
	category?: string | null;
	notes?: string | null;
}) {
	const rows = await sql<{ id: string }[]>`
    INSERT INTO stream_schedules (day_of_week, streamer_name, start_time, end_time, category, notes, status)
    VALUES (${input.day_of_week}, ${input.streamer_name}, ${input.start_time ?? null}, ${input.end_time ?? null},
            ${input.category ?? null}, ${input.notes ?? null}, 'active')
    RETURNING id
  `;
	return rows[0]!.id;
}

export async function deleteStream(id: string) {
	await sql`DELETE FROM stream_schedules WHERE id = ${id}`;
}

// ─── Settings admin ─────────────────────────────────────────────────────

export interface SettingRow {
	key: string;
	value: unknown;
	description: string | null;
	updated_at: Date;
}

export async function listSettings() {
	return await cached(SETTINGS_KEY, SETTINGS_CACHE_TTL_MS, async () => {
		return await sql<
			SettingRow[]
		>`SELECT key, value, description, updated_at FROM settings ORDER BY key`;
	});
}

export async function getSettingDetail(key: string): Promise<SettingRow | null> {
	const rows = await sql<SettingRow[]>`
    SELECT key, value, description, updated_at FROM settings WHERE key = ${key} LIMIT 1
  `;
	return rows[0] ?? null;
}

export async function setSetting(key: string, value: unknown, description?: string) {
	// Pas de `JSON.stringify(value)` : Bun.SQL encode déjà en JSON une valeur
	// liée à un paramètre `::jsonb`. La stringifier avant coup double
	// l'encodage (la colonne reçoit une chaîne, pas un objet) — voir le même
	// correctif dans `services/communaute.ts`.
	await sql`
    INSERT INTO settings (key, value, description, updated_at)
    VALUES (${key}, ${value}::jsonb, ${description ?? null}, NOW())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      description = COALESCE(EXCLUDED.description, settings.description),
      updated_at = NOW()
  `;
	invalidate(SETTINGS_KEY);
}

// ─── Team admin ─────────────────────────────────────────────────────────

export async function deleteTeamMember(id: string) {
	await sql`DELETE FROM team_members WHERE id = ${id}`;
	bustStats();
}

export async function setTeamMemberActive(id: string, active: boolean) {
	await sql`UPDATE team_members SET is_active = ${active}, updated_at = NOW() WHERE id = ${id}`;
	bustStats();
}
