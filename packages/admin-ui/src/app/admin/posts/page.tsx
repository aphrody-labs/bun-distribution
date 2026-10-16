import { db } from "@/lib/db";
import Link from "next/link";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Crayon, Document, Etoile, Plus } from "@shenron/ui/icones";
import { Badge } from "@shenron/ui/badge";
import { Button } from "@shenron/ui/button";
import { cn } from "@shenron/ui/lib/utils";
import type { PostStatus } from "@shenron/db/schema";

export const dynamic = "force-dynamic";

export const metadata = { title: "Articles" };

const FILTERS = [
  { key: "all", label: "Tous" },
  { key: "published", label: "Publiés" },
  { key: "scheduled", label: "Programmés" },
  { key: "draft", label: "Brouillons" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

export default async function AdminPosts({ searchParams }: { searchParams: Promise<{ statut?: string }> }) {
  const { statut } = await searchParams;
  const filter: FilterKey = FILTERS.some(f => f.key === statut) ? (statut as FilterKey) : "all";

  const all = await db.query.posts.findMany({
    orderBy: (p, { desc }) => desc(p.updatedAt),
    with: { author: true },
  });

  const now = new Date();
  /** Le statut *effectif* : un « publié » daté dans le futur est en réalité programmé. */
  const effectiveStatus = (p: { status: PostStatus; publishedAt: Date | null }): PostStatus =>
    p.status === "published" && p.publishedAt && p.publishedAt > now ? "scheduled" : p.status;

  const counts = {
    all: all.length,
    published: all.filter(p => effectiveStatus(p) === "published").length,
    scheduled: all.filter(p => effectiveStatus(p) === "scheduled").length,
    draft: all.filter(p => effectiveStatus(p) === "draft").length,
  };

  const posts = filter === "all" ? all : all.filter(p => effectiveStatus(p) === filter);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-white">Articles</h1>
          <p className="mt-1 text-[14px] text-white/50">
            Le journal du site. Rédaction, programmation et référencement.
          </p>
        </div>
        <Button size="lg" render={<Link href="/admin/posts/new" />}>
          <Plus className="size-4" />
          Nouvel article
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(f => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/admin/posts" : `/admin/posts?statut=${f.key}`}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              filter === f.key
                ? "bg-white text-black"
                : "bg-white/[0.06] text-white/65 hover:bg-white/[0.12] hover:text-white",
            )}
          >
            {f.label}
            <span className="tabular-nums opacity-55">{counts[f.key]}</span>
          </Link>
        ))}
      </div>

      {posts.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-xl border border-dashed border-white/15 px-6 py-16 text-center">
          <Document className="size-8 text-white/25" />
          <p className="text-[15px] font-medium text-white">
            {filter === "all" ? "Aucun article pour l'instant" : "Aucun article dans ce statut"}
          </p>
          {filter === "all" && (
            <>
              <p className="max-w-md text-[14px] text-white/50">
                Le journal est vide. Le premier article donnera le ton du site.
              </p>
              <Button size="lg" render={<Link href="/admin/posts/new" />} className="mt-2">
                <Plus className="size-4" />
                Écrire le premier article
              </Button>
            </>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-white/[0.07] overflow-hidden rounded-xl border border-white/10">
          {posts.map(post => {
            const status = effectiveStatus(post);
            const date = post.publishedAt ?? post.updatedAt;
            return (
              <li key={post.id} className="group bg-white/[0.02] transition-colors hover:bg-white/[0.05]">
                <Link href={`/admin/posts/${post.id}`} className="flex items-center gap-4 px-4 py-3.5">
                  <div className="relative hidden aspect-[16/10] w-24 shrink-0 overflow-hidden rounded-md bg-black/50 sm:block">
                    {post.cover ? (
                      <img src={post.cover} alt="" className="size-full object-cover" loading="lazy" />
                    ) : (
                      <span className="grid size-full place-items-center text-white/20">
                        <Document className="size-4" />
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-[15px] font-semibold text-white">
                      {post.featured && <Etoile className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />}
                      {post.title}
                    </p>
                    <p className="mt-0.5 truncate text-[13px] text-white/50">{post.excerpt}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-white/50">
                      <span>{post.author?.username ?? "—"}</span>
                      <span aria-hidden>·</span>
                      <span>{format(date, "d MMM yyyy", { locale: fr })}</span>
                      <span aria-hidden>·</span>
                      <span>{post.readingMinutes} min</span>
                      {post.tags?.length > 0 && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="truncate">{post.tags.join(", ")}</span>
                        </>
                      )}
                    </p>
                  </div>

                  <StatusPill status={status} />

                  <Crayon className="size-4 shrink-0 text-white/25 transition-colors group-hover:text-white/70" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: PostStatus }) {
  if (status === "draft") return <Badge variant="secondary">Brouillon</Badge>;
  if (status === "scheduled") return <Badge variant="warning">Programmé</Badge>;
  return <Badge variant="success">Publié</Badge>;
}
