import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { SITE_URL } from "@/lib/config";
import { ArticleEditor } from "../ArticleEditor";

export const dynamic = "force-dynamic";

export const metadata = { title: "Modifier l'article" };

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const post = await db.query.posts.findFirst({
    where: (p, { eq }) => eq(p.id, id),
  });
  if (!post) notFound();

  return (
    <ArticleEditor
      siteUrl={SITE_URL}
      initial={{
        id: post.id,
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        // Articles antérieurs à l'éditeur riche : `contentJson` est NULL et le
        // corps Markdown vit dans `body`. On le charge comme un paragraphe de
        // texte brut plutôt que de perdre le contenu — l'admin le remet en
        // forme à la première réédition.
        doc:
          post.contentJson ??
          (post.body.trim()
            ? {
                type: "doc",
                content: post.body
                  .split(/\n{2,}/)
                  .filter(p => p.trim())
                  .map(p => ({
                    type: "paragraph",
                    content: [{ type: "text", text: p.trim() }],
                  })),
              }
            : null),
        cover: post.cover,
        coverAlt: post.coverAlt,
        coverCaption: post.coverCaption,
        tags: post.tags ?? [],
        status: post.status,
        publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
        featured: post.featured,
        seoTitle: post.seoTitle,
        seoDescription: post.seoDescription,
        ogImage: post.ogImage,
        canonicalUrl: post.canonicalUrl,
        noindex: post.noindex,
      }}
    />
  );
}
