import { YouTubeIcon } from "@rosegriffon/ui";
import type { SVGProps } from "react";

/**
 * Logo YouTube — RÉ-EXPORT, plus une seconde copie du tracé.
 * Le `path` était identique à celui de `@rosegriffon/ui`, caractère pour
 * caractère. Voir `twitter.tsx` pour le raisonnement.
 */
export function YoutubeIcon(props: SVGProps<SVGSVGElement>) {
  return <YouTubeIcon title="YouTube" {...props} />;
}
