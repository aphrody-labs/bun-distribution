"use client";

/**
 * ModerationQueue — la file des commentaires, toutes surfaces confondues.
 *
 * Un seul écran pour les articles, les fiches wiki, les databooks et les tier
 * lists : c'est l'intérêt d'un socle social unique. Avant, seuls les articles
 * avaient des commentaires et personne ne pouvait les masquer sans passer par la
 * base de données.
 *
 * Les actions sont des Server Actions (pas des `fetch`) : elles s'exécutent avec
 * la session de l'admin et purgent le cache de l'écran elles-mêmes.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { hideCommentAction, pinCommentAction, restoreCommentAction } from "./_actions";
import { SOCIAL_KIND_LABELS, type SocialKind } from "../../../../lib/social-shared";
import { Coeur } from "@shenron/ui/icones";

export interface QueueRow {
  id: string;
  targetKind: SocialKind;
  targetId: string;
  body: string;
  status: "visible" | "hidden" | "deleted";
  pinned: boolean;
  createdAt: string;
  authorName: string;
  agentName: string | null;
  likes: number;
  href: string | null;
  targetLabel: string | null;
}

const dateFormat = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const STATUS_STYLES: Record<QueueRow["status"], string> = {
  visible: "border-emerald-500/40 text-emerald-300",
  hidden: "border-amber-500/40 text-amber-300",
  deleted: "border-white/20 text-white/40",
};

export function ModerationQueue({ rows }: { rows: readonly QueueRow[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function act(run: () => Promise<{ ok: boolean; error?: string }>): void {
    setError(null);
    startTransition(async () => {
      const res = await run();
      if (!res.ok) setError(res.error ?? "Action impossible.");
    });
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-white/10 bg-white/[0.02] p-6 text-[14px] text-white/50">
        Aucun commentaire pour l&apos;instant. La file se remplira dès la première discussion.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-[13px] text-red-400">
          {error}
        </p>
      )}

      {rows.map(row => (
        <article
          key={row.id}
          className="rounded-lg border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-white/20"
        >
          <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-white/45">
            <span
              className={`rounded-full border px-2 py-[1px] text-[11px] uppercase tracking-wider ${STATUS_STYLES[row.status]}`}
            >
              {row.status === "visible" ? "en ligne" : row.status === "hidden" ? "masqué" : "retiré par l'auteur"}
            </span>
            <span className="text-white/70">{row.authorName}</span>
            {row.agentName && (
              <span className="rounded-full border border-sky-400/40 px-2 text-[11px] text-sky-300">agent</span>
            )}
            <time dateTime={row.createdAt}>{dateFormat.format(new Date(row.createdAt))}</time>
            <span className="text-white/30">·</span>
            <span>
              {SOCIAL_KIND_LABELS[row.targetKind]}
              {row.targetLabel ? ` · ${row.targetLabel}` : ` · ${row.targetId}`}
            </span>
            {row.likes > 0 && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Coeur size={13} aria-hidden /> {row.likes}
              </span>
            )}
            {row.pinned && (
              <span className="rounded-full border border-dbz-orange/40 px-2 text-[11px] text-dbz-orange">épinglé</span>
            )}
          </header>

          <p className="mt-2.5 whitespace-pre-wrap text-[14px] leading-relaxed text-white/85">{row.body}</p>

          <footer className="mt-3 flex flex-wrap items-center gap-4 text-[13px]">
            {row.href && (
              <Link href={`${row.href}#c-${row.id}`} className="text-dbz-orange underline-offset-4 hover:underline">
                Voir en contexte ↗
              </Link>
            )}
            {row.status === "visible" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => act(() => hideCommentAction(row.id))}
                className="text-white/60 hover:text-red-300 disabled:opacity-40"
              >
                Masquer
              </button>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => act(() => restoreCommentAction(row.id))}
                className="text-white/60 hover:text-emerald-300 disabled:opacity-40"
              >
                Rétablir
              </button>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => act(() => pinCommentAction(row.id, row.pinned))}
              className="text-white/60 hover:text-dbz-orange disabled:opacity-40"
            >
              {row.pinned ? "Désépingler" : "Épingler"}
            </button>
          </footer>
        </article>
      ))}
    </div>
  );
}
