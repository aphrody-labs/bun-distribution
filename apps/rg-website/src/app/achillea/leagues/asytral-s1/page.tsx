import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import AstralLeagueClient from "../astral/astral-league-client";

/*
 * Alias historique de `/achillea/leagues/astral` (l'API accepte les quatre
 * identifiants `astral`, `astral-s1`, `asytral`, `asytral-s1`).
 *
 * Le canonical vise ici le chemin CIBLE : c'est le seul usage légitime de
 * `canonical`, regrouper des URL réellement équivalentes. C'est l'inverse de ce
 * que faisait le layout, qui pointait des pages DIFFÉRENTES vers une seule.
 */
export const metadata = metadonneesAchillea({
  titre: "Astral League",
  description:
    "Le championnat Astral League d'Achilléa : classement, calendrier des journées et règlement de la saison.",
  chemin: "/achillea/leagues/astral",
});

export default function AsytralLeagueSaison1AliasPage() {
  return <AstralLeagueClient />;
}
