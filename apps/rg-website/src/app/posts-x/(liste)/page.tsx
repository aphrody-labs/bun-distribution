import type { Metadata } from "next";

import { POSTS_X_ROSE_GRIFFON } from "@/app/news/tweet/[id]/tweet-page";
import { type FeedItem, TweetPost } from "@/app/news/news-client";
import { getPgPool } from "@/lib/db/pg";
import { Twitter } from "@/lib/icons-config";
import { absoluteUrl } from "@/lib/site-url";
import { SOCIAL_LINKS } from "@/lib/social-links";

export const metadata: Metadata = {
  alternates: { canonical: absoluteUrl("/posts-x") },
  description: "Les posts X de l'association Rose Griffon, archivés et traduits.",
  title: "Posts X | Rose Griffon",
};

// ISR : la récolte des posts revalide le chemin ; au plus tard toutes les 10 minutes.
export const dynamic = "force-static";
export const revalidate = 600;

interface PostRow {
  id: string;
  text: string | null;
  translation: string | null;
  created_at: string;
  author_username: string;
  author_name: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  media: any[] | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  quoted_tweets: any[] | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw_tweets: any[] | null;
}

async function postsRoseGriffon(): Promise<FeedItem[]> {
  try {
    const { rows } = await getPgPool().query<PostRow>(
      `SELECT id, text, translation, created_at, author_username, author_name, media, quoted_tweets, raw_tweets
         FROM tweets
        WHERE author_username = ANY($1::text[])
        ORDER BY created_at DESC
        LIMIT 120`,
      [[...POSTS_X_ROSE_GRIFFON.authors]],
    );
    return rows.map(t => ({
      author_id: t.author_username,
      author_name: t.author_name,
      author_username: t.author_username,
      category: "Tweet",
      date: t.created_at,
      excerpt: t.translation || t.text || "",
      id: t.id,
      image: t.media?.[0]?.preview_url || t.media?.[0]?.url || null,
      media: t.media ?? [],
      quotedTweets: t.quoted_tweets ?? [],
      slug: t.id,
      threadTweets: t.raw_tweets ?? [],
      title: "",
      type: "tweet",
    }));
  } catch (error) {
    console.error("[posts-x] lecture des posts impossible", error);
    return [];
  }
}

/**
 * Posts X de Rose Griffon — le compte de l'association, distinct du journal
 * d'Azalée (`/news`) et des Chroniques du Bouquet (`/chroniques`).
 */
export default async function PostsXPage() {
  const posts = await postsRoseGriffon();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-6 md:px-6">
      <header className="mb-8 flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-xl bg-[#1DA1F2]/10">
          <Twitter className="size-6 text-[#1DA1F2]" />
        </div>
        <div>
          <h1 className="text-2xl font-black tracking-tight text-on-surface md:text-3xl">Posts X</h1>
          <p className="text-sm text-on-surface-variant">
            Les publications de{" "}
            <a
              href={SOCIAL_LINKS.association.x}
              className="font-semibold text-primary hover:underline"
              rel="noopener"
              target="_blank"
            >
              {POSTS_X_ROSE_GRIFFON.handle}
            </a>
          </p>
        </div>
      </header>

      {posts.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {posts.map(item => (
            <TweetPost key={item.id} item={item} basePath="/posts-x" />
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-outline-variant/20 p-10 text-center text-on-surface-variant">
          Aucun post archivé pour le moment.
        </p>
      )}
    </main>
  );
}
