"use client";

import { AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Button } from "@rosegriffon/ui";

/** État d'erreur commun aux fiches wiki, avec une action de reprise explicite. */
export function WikiErrorState({ title, backHref, backLabel }: { title: string; backHref: string; backLabel: string }) {
  return (
    <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center space-y-6 p-6 text-center">
      <div className="rounded-full bg-error-container p-5 text-on-error-container">
        <AlertCircle className="size-10" strokeWidth={1.5} />
      </div>
      <div className="max-w-md space-y-2">
        <h2 className="font-display text-2xl font-black text-on-surface">{title}</h2>
        <p className="text-on-surface-variant">Les données sont momentanément indisponibles.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={() => window.location.reload()} variant="outline" className="gap-2 rounded-full">
          <RefreshCw className="size-4" />
          Réessayer
        </Button>
        <Button asChild className="gap-2 rounded-full">
          <Link href={backHref}>
            <ArrowLeft className="size-4" />
            {backLabel}
          </Link>
        </Button>
      </div>
    </div>
  );
}
