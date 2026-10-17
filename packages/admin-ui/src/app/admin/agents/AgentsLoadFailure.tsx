"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * État d'échec d'une lecture de /admin/agents. « Réessayer » relance le rendu serveur de la page
 * (`router.refresh`), donc les deux lectures ; le bouton reste inactif pendant la tentative.
 */
export function AgentsLoadFailure({ title, message, code }: { title: string; message: string; code: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div role="alert" className="rounded-lg border border-red-500/40 bg-red-950/30 p-5">
      <h2 className="text-[15px] font-semibold text-red-200">{title}</h2>
      <p className="mt-1.5 text-[13px] text-white/60">{message}</p>
      {code && <p className="mt-1.5 font-mono text-[12px] text-white/40">Code : {code}</p>}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(() => {
            router.refresh();
          })
        }
        className="toriyama-btn mt-4 !text-[0.75rem] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Nouvelle tentative…" : "Réessayer"}
      </button>
    </div>
  );
}
