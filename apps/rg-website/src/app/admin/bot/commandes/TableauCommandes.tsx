"use client";

import { useMemo, useState } from "react";
import { Search, ShieldCheck } from "lucide-react";

import {
  Badge,
  Input,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rosegriffon/ui";
import { PROFILS_BOT, type CommandeBot, type NomProfilBot } from "@rosegriffon/types/bot";

/**
 * Le catalogue des slash commands, filtrable.
 *
 * ── POURQUOI UNE RECHERCHE ET NON UN SIMPLE TABLEAU ────────────────────────
 * Les deux profils servent ensemble plus de cent chemins. Sans filtre, la seule
 * question qu'on se pose vraiment devant cette page — « est-ce que /truc existe,
 * et sur quel bot ? » — se répond en faisant défiler. Le filtre par profil sert
 * la même question sous l'autre angle : ce qu'un bot donné sait faire.
 */
export function TableauCommandes({ commandes }: { commandes: CommandeBot[] }) {
  const [recherche, setRecherche] = useState("");
  const [profil, setProfil] = useState<NomProfilBot | "tous">("tous");
  const [portee, setPortee] = useState<"toutes" | "publiques" | "reservees">("toutes");

  const filtrees = useMemo(() => {
    const aiguille = recherche.trim().toLowerCase();
    return commandes.filter(commande => {
      if (profil !== "tous" && commande.profil !== profil) {
        return false;
      }
      if (portee === "publiques" && commande.reservee) {
        return false;
      }
      if (portee === "reservees" && !commande.reservee) {
        return false;
      }
      if (aiguille === "") {
        return true;
      }
      return commande.chemin.toLowerCase().includes(aiguille) || commande.description.toLowerCase().includes(aiguille);
    });
  }, [commandes, recherche, profil, portee]);

  /** Regroupement par racine : c'est l'arbre que Discord affiche au membre. */
  const parRacine = useMemo(() => {
    const groupes = new Map<string, CommandeBot[]>();
    for (const commande of filtrees) {
      const liste = groupes.get(commande.racine);
      if (liste) {
        liste.push(commande);
      } else {
        groupes.set(commande.racine, [commande]);
      }
    }
    return [...groupes.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr"));
  }, [filtrees]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            className="pl-9"
            placeholder="Chercher une commande ou une description…"
            value={recherche}
            onChange={evenement => setRecherche(evenement.target.value)}
            aria-label="Filtrer les commandes"
          />
        </div>
        <NativeSelect
          value={profil}
          onChange={evenement => setProfil(evenement.target.value as NomProfilBot | "tous")}
          aria-label="Filtrer par profil"
        >
          <NativeSelectOption value="tous">Les deux bots</NativeSelectOption>
          <NativeSelectOption value="rg">{PROFILS_BOT.rg.titre}</NativeSelectOption>
          <NativeSelectOption value="azalee">{PROFILS_BOT.azalee.titre}</NativeSelectOption>
        </NativeSelect>
        <NativeSelect
          value={portee}
          onChange={evenement => setPortee(evenement.target.value as "toutes" | "publiques" | "reservees")}
          aria-label="Filtrer par portée"
        >
          <NativeSelectOption value="toutes">Toutes portées</NativeSelectOption>
          <NativeSelectOption value="publiques">Publiques</NativeSelectOption>
          <NativeSelectOption value="reservees">Réservées au staff</NativeSelectOption>
        </NativeSelect>
      </div>

      <p className="text-sm text-muted-foreground">
        {filtrees.length} commande{filtrees.length > 1 ? "s" : ""} sur {commandes.length}.
      </p>

      <div className="space-y-6">
        {parRacine.map(([racine, liste]) => (
          <section key={racine} className="space-y-2">
            <h3 className="flex items-center gap-2 font-mono text-sm font-semibold">
              /{racine}
              {liste[0]?.reservee && (
                <Badge variant="outline" className="gap-1 font-sans">
                  <ShieldCheck className="size-3" aria-hidden />
                  staff
                </Badge>
              )}
            </h3>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-64">Chemin</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-56">Options</TableHead>
                    <TableHead className="w-28">Bot</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {liste.map(commande => (
                    <TableRow key={`${commande.profil}:${commande.chemin}`}>
                      <TableCell className="font-mono text-xs">/{commande.chemin}</TableCell>
                      <TableCell className="text-sm">{commande.description}</TableCell>
                      <TableCell>
                        {commande.options.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {commande.options.map(option => (
                              <Badge
                                key={option.nom}
                                variant={option.requise ? "default" : "outline"}
                                className="font-mono text-[10px]"
                                title={`${option.description} (${option.type}${option.requise ? ", requise" : ""})`}
                              >
                                {option.nom}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <span
                          className="inline-flex items-center gap-1.5 text-xs"
                          title={PROFILS_BOT[commande.profil].unite}
                        >
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: PROFILS_BOT[commande.profil].couleurHex }}
                            aria-hidden
                          />
                          {PROFILS_BOT[commande.profil].titre}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        ))}
      </div>

      {filtrees.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Aucune commande ne correspond.
        </p>
      )}
    </div>
  );
}
