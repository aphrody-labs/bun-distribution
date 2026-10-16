import { cn } from "@rosegriffon/ui";
import { Ban } from "lucide-react";

import { estInterdiction } from "@/lib/x-campagnes/types";

/*
 * Le règlement de la campagne — composant SERVEUR, aucun JavaScript envoyé.
 *
 * Les règles viennent de `x_campagnes.reglement` (une phrase par élément, dans
 * l'ordre), JAMAIS du TSX : la campagne suivante aura les siennes, et les
 * changer ne doit pas demander un déploiement.
 *
 * Hiérarchie assumée : ce sont des CONDITIONS D'ADMISSION, pas des mentions de
 * bas de page. Elles sont donc numérotées, écrites au corps de texte courant, et
 * celles qui interdisent quelque chose (« L'utilisation d'IA est absolument
 * interdite ») portent en plus les couleurs d'erreur du thème et un pictogramme.
 * `estInterdiction()` est une heuristique sur le français, pas une liste des
 * règles de cette campagne-ci : un faux négatif rend la règle sans accent, à sa
 * place, en entier — jamais masquée.
 */
export function ReglementCampagne({ reglement }: { reglement: string[] }) {
  if (reglement.length === 0) {
    return null;
  }

  return (
    <ol className="grid list-none gap-2 p-0">
      {reglement.map((regle, position) => {
        const interdiction = estInterdiction(regle);
        return (
          <li
            // La position fait partie de la clé : rien n'interdit à une campagne
            // de répéter deux fois la même phrase, et `key={regle}` seul donnait
            // alors deux clés identiques (React n'en rendrait qu'une proprement).
            key={`${position}-${regle}`}
            className={cn(
              "flex items-start gap-2.5 rounded-xl border p-3",
              interdiction
                ? "border-error/50 bg-error-container"
                : "border-outline-variant/60 bg-surface-container-low",
            )}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                interdiction ? "bg-error text-on-error" : "bg-primary text-on-primary",
              )}
              aria-hidden
            >
              {interdiction ? <Ban className="size-3.5" /> : position + 1}
            </span>
            <p
              className={cn(
                "text-sm leading-snug",
                interdiction ? "font-semibold text-on-error-container" : "text-on-surface",
              )}
            >
              {regle}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
