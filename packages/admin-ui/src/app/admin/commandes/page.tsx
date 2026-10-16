import type { Metadata } from "next";
import { CommandRunner } from "./CommandRunner";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Exécuter une commande",
  robots: { index: false },
};

export default function AdminCommandesPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header>
        <h1 className="mb-2 font-saiyan text-4xl text-dbz-orange">
          EXÉCUTER UNE COMMANDE
        </h1>
        <p className="mb-1 text-sm text-white/60">
          <strong className="text-white/80">Toutes</strong> les slash commands
          du bot, avec tous leurs paramètres, exécutables à distance (hors
          Discord). Le résultat de la commande est affiché ici.
        </p>
        <p className="text-xs uppercase tracking-widest text-white/50">
          Opérations réelles en production · effet immédiat · réponses capturées
        </p>
      </header>
      <CommandRunner />
    </div>
  );
}
