import { Button } from "@rosegriffon/ui";
import { Edit, ExternalLink } from "lucide-react";
import Link from "next/link";

import TwitterIcon from "@/shared/icons/twitter";

interface ProfileIdentityProps {
  website: string | null;
  twitterHandle: string | null;
  isOwnProfile: boolean;
}

/**
 * Les liens du profil, et rien d'autre.
 *
 * ── CE QUE CE COMPOSANT NE FAIT PLUS ───────────────────────────────────────
 * Il portait l'avatar, le nom, le pseudo, la biographie, le rôle et les
 * badges — tout ce que la carte de joueur affiche désormais juste au-dessus.
 * Les garder ici aurait donné deux fois la même identité sur la même page, à
 * deux pas d'écart et dans deux mises en forme différentes.
 *
 * Restent les liens sortants et le bouton d'édition : ce sont des ACTIONS, pas
 * de l'identité.
 */
export function ProfileIdentity({ website, twitterHandle, isOwnProfile }: ProfileIdentityProps) {
  const lienSite = lienSuivable(website);
  const twitter = twitterHandle?.replace("@", "").trim();

  if (!lienSite && !twitter && !isOwnProfile) {
    return null;
  }

  return (
    <section aria-label="Liens du profil" className="mt-4 mb-8 flex flex-wrap items-center gap-x-4 gap-y-2">
      {lienSite && (
        <a
          href={lienSite}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          Site web
        </a>
      )}

      {twitter && (
        <a
          href={`https://twitter.com/${twitter}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary"
        >
          <TwitterIcon className="size-4" aria-hidden="true" />@{twitter}
        </a>
      )}

      {isOwnProfile && (
        <Button asChild variant="outline" size="sm" className="ml-auto h-9 gap-1.5">
          <Link href="/settings">
            <Edit className="size-3.5" aria-hidden="true" />
            Modifier mon profil
          </Link>
        </Button>
      )}
    </section>
  );
}

/**
 * Un lien de profil n'est suivi que s'il s'ouvre dans un navigateur.
 *
 * La validation du formulaire refuse désormais les schémas exotiques, mais des
 * lignes plus anciennes peuvent encore porter un `javascript:` accepté à
 * l'époque — et c'est ici, au rendu, que cela deviendrait exécutable.
 */
function lienSuivable(valeur: string | null): string | null {
  if (!valeur) {
    return null;
  }
  try {
    const url = new URL(valeur);
    return url.protocol === "http:" || url.protocol === "https:" ? valeur : null;
  } catch {
    return null;
  }
}
