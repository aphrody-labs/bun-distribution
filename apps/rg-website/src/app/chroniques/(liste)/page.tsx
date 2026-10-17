import type { Metadata } from "next";

import type { FeedItem } from "@/app/news/news-client";
import { ArticleCard } from "@/components/news/ArticleCard";
import { getPgPool } from "@/lib/db/pg";
import { Newspaper } from "@/lib/icons-config";
import { absoluteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  alternates: { canonical: absoluteUrl("/chroniques") },
  description:
    "Les Chroniques du Bouquet : la vie de l'association Rose Griffon, ses annonces, ses événements et ses projets communautaires.",
  title: "Chroniques du Bouquet | Rose Griffon",
};

// ISR : la publication d'une chronique revalide le chemin ; au plus tard toutes les 5 minutes.
export const dynamic = "force-static";
export const revalidate = 300;

interface ChroniqueRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  created_at: string;
  published_at: string | null;
  featured_image_url: string | null;
  category: string | null;
  author_id: string | null;
}

async function chroniquesPubliees(): Promise<FeedItem[]> {
  try {
    const { rows } = await getPgPool().query<ChroniqueRow>(
      `SELECT id, slug, title, excerpt, created_at, published_at, featured_image_url, category, author_id
         FROM articles
        WHERE status = 'published' AND app = 'website'
        ORDER BY published_at DESC NULLS LAST, created_at DESC`,
    );
    return rows.map(row => ({
      author_id: row.author_id ?? "",
      category: row.category ?? "",
      date: row.published_at || row.created_at,
      excerpt: row.excerpt ?? "",
      id: row.id,
      image: row.featured_image_url,
      slug: row.slug,
      title: row.title,
      type: "article",
    }));
  } catch (error) {
    console.error("[chroniques] lecture des chroniques impossible", error);
    return [];
  }
}

/**
 * Chroniques du Bouquet — le journal de l'association.
 *
 * Distinct du journal d'Azalée (`/news`, articles et posts X du wiki) et des
 * posts X de Rose Griffon (`/posts-x`) : trois corpus, trois fils.
 */
export default async function ChroniquesPage() {
  const chroniques = await chroniquesPubliees();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-6 md:px-6">
      <header className="mb-8 flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-xl bg-primary-container">
          <Newspaper className="size-6 text-on-primary-container" />
        </div>
        <div>
          <h1 className="text-2xl font-black tracking-tight text-on-surface md:text-3xl">Chroniques du Bouquet</h1>
          <p className="text-sm text-on-surface-variant">La vie de l&apos;association Rose Griffon</p>
        </div>
      </header>

      {chroniques.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {chroniques.map(item => (
            <ArticleCard key={item.id} item={item} basePath="/chroniques" />
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-outline-variant/20 p-10 text-center text-on-surface-variant">
          Aucune chronique publiée pour le moment.
        </p>
      )}
    </main>
  );
}
