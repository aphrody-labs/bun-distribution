import type * as React from "react";

import { cn } from "../lib/utils";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium text-foreground select-none",
        "group-data-[disabled=true]/field:pointer-events-none group-data-[disabled=true]/field:opacity-50",
        // Cf. `input.tsx` / `textarea.tsx` : `pointer-events-none` annule le curseur
        // « interdit » qu'on demande juste après, si bien que le libellé d'un champ
        // désactivé restait au curseur normal. Le retirer ne rend rien de cliquable :
        // le navigateur ne donne jamais le focus à un contrôle désactivé.
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
