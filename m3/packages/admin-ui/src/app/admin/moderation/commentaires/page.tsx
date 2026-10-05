/**
 * /admin/moderation/commentaires — la file unique des commentaires du site.
 *
 * Elle existe parce que le socle social est polymorphe : un commentaire peut
 * viser un article, une fiche wiki, un databook ou une tier list. Une file par
 * surface aurait signifié quatre écrans et trois oublis. Ici, un seul, trié du
 * plus récent au plus ancien, avec le lien de retour vers le contexte.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { listModerationQueue } from "@/lib/social";
import { COMMENT_STATUSES, type CommentStatus } from "@/db/schema";
import { ModerationQueue, type QueueRow } from "./ModerationQueue";
import { PublicViewLink } from "@/components/kit";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Commentaires" };

const FILTERS = [
  { key: "all", label: "Tous" },
  { key: "visible", label: "En ligne" },
  { key: "hidden", label: "Masqués" },
  { key: "deleted", label: "Retirés" },
] as const;

export default async function CommentModerationPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string }>;
}) {
  const { statut } = await searchParams;
  const filter =
    statut && (statut === "all" || (COMMENT_STATUSES as readonly string[]).includes(statut))
      ? (statut as CommentStatus | "all")
      : "all";

  const { entries, total } = await listModerationQueue({ status: filter, limit: 100 });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-white">Commentaires</h1>
          <p className="mt-1 text-[14px] text-white/50">
            Articles, fiches wiki, databooks et tier lists — une seule file. Masquer conserve la
            ligne et la trace du modérateur ; rien n&apos;est effacé.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <PublicViewLink href="/news/fil/discussions" label="Voir le fil public" />
          <Link
            href="/admin/moderation"
            className="text-[13px] text-white/60 underline-offset-4 hover:text-white hover:underline"
          >
            Modération Discord →
          </Link>
        </div>
      </header>

      <nav className="flex flex-wrap items-center gap-2" aria-label="Filtrer par statut">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "?" : `?statut=${f.key}`}
            aria-current={filter === f.key ? "page" : undefined}
            className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
              filter === f.key
                ? "border-dbz-orange/60 bg-dbz-orange/10 text-dbz-orange"
                : "border-white/15 text-white/60 hover:border-white/30 hover:text-white"
            }`}
          >
            {f.label}
          </Link>
        ))}
        <span className="ml-auto text-[13px] tabular-nums text-white/40">{total} message(s)</span>
      </nav>

      <ModerationQueue rows={entries as QueueRow[]} />
    </div>
  );
}
