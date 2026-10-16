import type { Kysely } from "kysely";
import type { Database } from "@rosegriffon/db/schema";

export abstract class ContentService {
  public static async getNewsFeed(db: Kysely<Database>, page = 1, category?: string, q?: string) {
    const limit = 12;
    const offset = (page - 1) * limit;

    let query = db.selectFrom("articles").selectAll().where("status", "=", "published").where("app", "=", "azalee");

    if (category) {
      query = query.where("category", "=", category);
    }

    if (q) {
      query = query.where("title", "ilike", `%${q}%`);
    }

    const rows = await query
      .orderBy("published_at", "desc")
      .limit(limit + 1)
      .offset(offset)
      .execute();

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(r => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      excerpt: r.excerpt,
      category: r.category,
      featuredImageUrl: r.featured_image_url,
      authorId: r.author_id,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
      publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
    }));

    return {
      items,
      page,
      hasMore,
    };
  }

  public static async getCalendarEvents(db: Kysely<Database>) {
    const rows = await db.selectFrom("events").selectAll().orderBy("start_time", "asc").execute();

    return {
      events: rows.map(e => ({
        id: String(e.id),
        title: e.title,
        description: e.description,
        location: e.location,
        startTime: new Date(e.start_time).toISOString(),
        endTime: new Date(e.end_time).toISOString(),
      })),
    };
  }
}
