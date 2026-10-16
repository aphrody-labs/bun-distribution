"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";

import {
  Badge,
  Button,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rosegriffon/ui";

import {
  LIBELLES_PROVENANCE,
  LIBELLES_TRI,
  TRIS_MEMBRES,
  type PageMembres,
  type ProvenanceXp,
} from "@/lib/bot/membres-shared";

/**
 * Le classement, avec son tri et sa pagination dans l'URL.
 *
 * ── POURQUOI L'ÉTAT VIT DANS L'URL ET NON DANS `useState` ──────────────────
 * Un classement se partage : « regarde, il est 4e ». Un état local rendrait ce
 * lien inutilisable — la page s'ouvrirait toujours sur la première page triée
 * par XP. Ici le tri et la page sont des paramètres d'URL, donc la lecture est
 * faite côté serveur (RSC) et le lien porte ce qu'il montre.
 */
export function TableauMembres({ page }: { page: PageMembres }) {
  const router = useRouter();
  const parametres = useSearchParams();

  const naviguer = useCallback(
    (modifications: Record<string, string>) => {
      const suivants = new URLSearchParams(parametres.toString());
      for (const [clef, valeur] of Object.entries(modifications)) {
        if (valeur === "") {
          suivants.delete(clef);
        } else {
          suivants.set(clef, valeur);
        }
      }
      router.push(`/admin/bot/membres?${suivants.toString()}`);
    },
    [parametres, router],
  );

  const nombre = (valeur: number) => valeur.toLocaleString("fr-FR");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="tri" className="text-sm text-muted-foreground">
            Trier par
          </label>
          <NativeSelect
            id="tri"
            value={page.tri}
            onChange={evenement => naviguer({ page: "", tri: evenement.target.value })}
          >
            {TRIS_MEMBRES.map(tri => (
              <NativeSelectOption key={tri} value={tri}>
                {LIBELLES_TRI[tri]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <p className="text-sm text-muted-foreground">
          {nombre(page.total)} membre{page.total > 1 ? "s" : ""} avec de l&apos;expérience · page {page.page} sur{" "}
          {page.pages}
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16 text-right">Rang</TableHead>
              <TableHead>Membre</TableHead>
              <TableHead className="w-24 text-right">Niveau</TableHead>
              <TableHead className="w-28 text-right">Expérience</TableHead>
              <TableHead className="w-28 text-right">Messages</TableHead>
              <TableHead className="w-28 text-right">Jetons</TableHead>
              <TableHead className="w-44">Source de l&apos;XP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.lignes.map(ligne => (
              <TableRow key={ligne.discordId}>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">{ligne.rang}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {ligne.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ligne.avatarUrl} alt="" className="size-6 rounded-full" loading="lazy" />
                    ) : (
                      <span className="size-6 rounded-full bg-muted" aria-hidden />
                    )}
                    <span className="min-w-0 truncate font-medium">{ligne.pseudo}</span>
                    {ligne.parti && (
                      <Badge variant="outline" className="shrink-0 text-xs">
                        parti
                      </Badge>
                    )}
                  </div>
                  {ligne.titre && <p className="mt-0.5 text-xs text-muted-foreground">{ligne.titre}</p>}
                </TableCell>
                <TableCell className="text-right font-medium">{ligne.niveau}</TableCell>
                <TableCell className="text-right font-mono text-sm">{nombre(ligne.xp)}</TableCell>
                <TableCell className="text-right font-mono text-sm text-muted-foreground">
                  {ligne.messages === 0 ? "—" : nombre(ligne.messages)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-muted-foreground">
                  {ligne.jetons === 0 ? "—" : nombre(ligne.jetons)}
                </TableCell>
                <TableCell>
                  <PastilleProvenance provenance={ligne.provenance} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {page.lignes.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Aucun membre n&apos;a encore d&apos;expérience.
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={page.page <= 1}
          onClick={() => naviguer({ page: String(page.page - 1) })}
        >
          <ChevronLeft className="size-4" aria-hidden />
          Précédent
        </Button>
        <Link href="/admin/bot" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
          Retour à la vue d&apos;ensemble
        </Link>
        <Button
          variant="outline"
          size="sm"
          disabled={page.page >= page.pages}
          onClick={() => naviguer({ page: String(page.page + 1) })}
        >
          Suivant
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>

      {/*
       * La légende n'est pas décorative : « historique » désigne une XP qui
       * est un MINORANT (le seuil du palier annoncé par un embed de montée de
       * niveau), pas une mesure. Comparer un tel chiffre à une valeur d'API
       * sans le savoir mène à des conclusions fausses.
       */}
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="space-y-1">
          <p>
            <strong>{LIBELLES_PROVENANCE.api}</strong> et <strong>{LIBELLES_PROVENANCE.classement}</strong> : valeurs
            exactes, relevées chez Noctaly.
          </p>
          <p>
            <strong>{LIBELLES_PROVENANCE.historique}</strong> : XP reconstituée depuis les annonces de montée de niveau
            retrouvées dans les salons — c&apos;est le seuil du palier, donc un minimum, pas la valeur réelle.
          </p>
        </div>
      </div>
    </div>
  );
}

const STYLES_PROVENANCE: Readonly<Record<ProvenanceXp, string>> = {
  api: "border-succes/40 text-succes",
  classement: "border-info/40 text-info",
  historique: "border-alerte/40 text-alerte",
  bot: "border-border text-muted-foreground",
};

function PastilleProvenance({ provenance }: { provenance: ProvenanceXp }) {
  return (
    <Badge variant="outline" className={`text-xs ${STYLES_PROVENANCE[provenance]}`}>
      {LIBELLES_PROVENANCE[provenance]}
    </Badge>
  );
}
