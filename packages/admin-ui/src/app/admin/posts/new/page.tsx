import { requireAdmin } from "@/lib/session";
import { SITE_URL } from "@/lib/config";
import { ArticleEditor } from "../ArticleEditor";

export const dynamic = "force-dynamic";

export const metadata = { title: "Nouvel article" };

export default async function NewPostPage() {
  await requireAdmin();

  return (
    <ArticleEditor
      siteUrl={SITE_URL}
      initial={{
        title: "",
        slug: "",
        excerpt: "",
        doc: null,
        cover: null,
        coverAlt: null,
        coverCaption: null,
        tags: [],
        status: "draft",
        publishedAt: null,
        featured: false,
        seoTitle: null,
        seoDescription: null,
        ogImage: null,
        canonicalUrl: null,
        noindex: false,
      }}
    />
  );
}
