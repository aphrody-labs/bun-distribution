import { TwitchIcon as TwitchIconPartage } from "@rosegriffon/ui";
import type { SVGProps } from "react";

/**
 * Logo Twitch — RÉ-EXPORT, plus une seconde copie du tracé.
 * Le `path` était identique à celui de `@rosegriffon/ui`, caractère pour
 * caractère. Voir `twitter.tsx` pour le raisonnement.
 */
export function TwitchIcon(props: SVGProps<SVGSVGElement>) {
  return <TwitchIconPartage title="Twitch" {...props} />;
}
