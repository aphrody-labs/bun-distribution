import { getPgPool } from "@/lib/db/pg";
import type { Tables } from "@rosegriffon/db";

export type Article = Tables<"articles">;

export interface GetArticlesOptions {
  page?: number;
  limit?: number;
  status?: string;
  category?: string;
  query?: string;
  app?: string;
}

export interface ArticlesResponse {
  data: Article[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

type ArticleRow = Article & { full_count: string };

export async function getArticles({
  page = 1,
  limit = 10,
  status,
  category,
  query,
  app,
}: GetArticlesOptions = {}): Promise<ArticlesResponse> {
  const pool = getPgPool();
  const from = (page - 1) * limit;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (app && app !== "all") {
    params.push(app);
    conditions.push(`app = $${params.length}`);
  } else {
    conditions.push("app IN ('website', 'azalee')");
  }

  if (status && status !== "all") {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  if (category && category !== "all") {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }

  if (query) {
    params.push(`%${query}%`);
    const idx = params.length;
    conditions.push(`(title ILIKE $${idx} OR excerpt ILIKE $${idx} OR category ILIKE $${idx})`);
  }

  const whereClause = conditions.join(" AND ");

  params.push(limit);
  const limitIdx = params.length;
  params.push(from);
  const offsetIdx = params.length;

  try {
    const { rows } = await pool.query<ArticleRow>(
      `SELECT *, count(*) OVER() AS full_count
			 FROM articles
			 WHERE ${whereClause}
			 ORDER BY created_at DESC
			 LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    const [firstRow] = rows;
    const total = firstRow ? Number(firstRow.full_count) : 0;
    const data: Article[] = rows.map(({ full_count: _full_count, ...rest }) => rest);

    return {
      data,
      meta: {
        limit,
        page,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    console.error("Error fetching articles:", error);
    return {
      data: [],
      meta: { limit, page, total: 0, totalPages: 0 },
    };
  }
}

export async function getArticleBySlug(slug: string): Promise<Article | null> {
  const pool = getPgPool();

  try {
    const { rows } = await pool.query<Article>(
      "SELECT * FROM articles WHERE slug = $1 AND app IN ('website', 'azalee') LIMIT 1",
      [slug],
    );

    const [article] = rows;
    if (!article) {
      console.error(`Error fetching article with slug ${slug}: not found`);
      return null;
    }

    return article;
  } catch (error) {
    console.error(`Error fetching article with slug ${slug}:`, error);
    return null;
  }
}

export async function getArticleStats() {
  const pool = getPgPool();

  try {
    const { rows } = await pool.query<Pick<Article, "status" | "category">>(
      "SELECT status, category FROM articles WHERE app IN ('website', 'azalee')",
    );

    const total = rows.length;
    const published = rows.filter(a => a.status === "published").length;
    const draft = rows.filter(a => a.status === "draft").length;
    const categories = [...new Set(rows.map(a => a.category).filter(Boolean))] as string[];

    return {
      categories,
      draft,
      published,
      total,
    };
  } catch (error) {
    console.error("Error fetching article stats:", error);
    return { categories: [], draft: 0, published: 0, total: 0 };
  }
}
