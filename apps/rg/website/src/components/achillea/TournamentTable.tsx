"use client";

import Link from "next/link";
import type { TournamentListItem } from "@rosegriffon/achillea-types/domain/tournament";
import { Badge, Skeleton } from "@rosegriffon/ui";
import { Calendar, ChevronRight, Trophy } from "lucide-react";

interface TournamentTableProps {
  tournaments: TournamentListItem[];
  loading?: boolean;
  className?: string;
}

function statusLabel(status: string | null): string {
  switch (status) {
    case "Open":
      return "Inscriptions ouvertes";
    case "Ongoing":
      return "En cours";
    case "Finished":
      return "Terminé";
    case "Canceled":
      return "Annulé";
    default:
      return status || "Statut à confirmer";
  }
}

function summary(description: string): string {
  const clean = description.replace(/\s+/g, " ").trim();
  if (!clean) return "Description non disponible";
  return clean.length > 125 ? `${clean.slice(0, 122).trimEnd()}…` : clean;
}

function publicationDate(value: Date): string {
  return new Date(value).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function TournamentTable({ tournaments, loading = false, className }: TournamentTableProps) {
  if (loading) {
    return (
      <output aria-label="Chargement des tournois" className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </output>
    );
  }

  if (!tournaments.length) {
    return (
      <output className="text-center py-12 border border-dashed border-outline/30 rounded-2xl p-6 text-lg text-on-surface-variant">
        <Trophy aria-hidden="true" className="size-10 mx-auto mb-2 opacity-40" />
        <p className="font-semibold">Aucun tournoi trouvé</p>
      </output>
    );
  }

  return (
    <div className={className}>
      <ul className="grid gap-4 lg:hidden" aria-label="Tournois">
        {tournaments.map((t) => (
          <li
            key={t.id}
            className="rounded-2xl border border-outline/30 bg-surface p-4 text-lg text-on-surface"
          >
            <h2 className="font-bold leading-snug">{t.name}</h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  t.status === "Finished" || t.status === "Canceled" ? "secondary" : "default"
                }
                className="text-lg"
              >
                {statusLabel(t.status)}
              </Badge>
              <span>{t.type === "TOURNAMENT" ? "Tournoi" : t.type}</span>
            </div>
            <p className="mt-3 text-on-surface-variant">{summary(t.description)}</p>
            <p className="mt-3 flex items-center gap-2 text-on-surface-variant">
              <Calendar aria-hidden="true" className="size-5" />
              Publié le {publicationDate(t.createdAt)}
            </p>
            <Link
              href={`/achillea/tournaments/${t.id}`}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-outline/40 px-4 font-semibold text-primary focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Détails et description complète
              <ChevronRight aria-hidden="true" className="size-5" />
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-2xl border border-outline/30 bg-surface lg:block">
        <table className="w-full text-left text-lg">
          <caption className="sr-only">Liste des tournois Achilléa</caption>
          <thead className="border-b border-outline/30 bg-surface-variant/40 font-bold text-on-surface-variant">
            <tr>
              <th scope="col" className="px-4 py-4">
                Tournoi
              </th>
              <th scope="col" className="px-4 py-4">
                Type
              </th>
              <th scope="col" className="px-4 py-4">
                Description
              </th>
              <th scope="col" className="px-4 py-4">
                Publié
              </th>
              <th scope="col" className="px-4 py-4">
                Statut
              </th>
              <th scope="col" className="px-4 py-4">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline/20 text-on-surface">
            {tournaments.map((t) => (
              <tr key={t.id} className="hover:bg-surface-variant/20">
                <th scope="row" className="px-4 py-4 font-semibold">
                  <Link
                    href={`/achillea/tournaments/${t.id}`}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg text-primary focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <Trophy aria-hidden="true" className="size-6 shrink-0" />
                    {t.name}
                  </Link>
                </th>
                <td className="px-4 py-4">{t.type === "TOURNAMENT" ? "Tournoi" : t.type}</td>
                <td className="max-w-sm px-4 py-4 text-on-surface-variant">
                  {summary(t.description)}
                </td>
                <td className="px-4 py-4 whitespace-nowrap">{publicationDate(t.createdAt)}</td>
                <td className="px-4 py-4">
                  <Badge
                    variant={
                      t.status === "Finished" || t.status === "Canceled" ? "secondary" : "default"
                    }
                    className="text-lg whitespace-nowrap"
                  >
                    {statusLabel(t.status)}
                  </Badge>
                </td>
                <td className="px-4 py-4">
                  <Link
                    href={`/achillea/tournaments/${t.id}`}
                    className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-outline/40 px-4 font-semibold text-primary focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    Détails
                    <ChevronRight aria-hidden="true" className="size-5" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
