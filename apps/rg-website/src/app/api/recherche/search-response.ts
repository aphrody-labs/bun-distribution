import { NextResponse } from "next/server";
import { grouperParDomaine, rechercherPartout, type ExecuteursSql } from "@rosegriffon/search";
import { cachePublic } from "@/lib/cache-public";

/** Réponse HTTP de la recherche unifiée, avec exécuteur SQL injecté. */
export async function respondreRecherche(requete: Request, executer: ExecuteursSql) {
  const terme = (new URL(requete.url).searchParams.get("q") ?? "").trim();
  if (terme.length < 2) return NextResponse.json({ groupes: [], resultats: [] });

  try {
    const resultats = await rechercherPartout(executer, terme, {
      limiteParSource: 4,
      limiteTotale: 12,
    });
    // Mêmes résultats pour tout le monde : le CDN absorbe la frappe répétée des mêmes termes.
    return NextResponse.json({ groupes: grouperParDomaine(resultats), resultats }, { headers: cachePublic(300) });
  } catch (erreur) {
    console.error("Erreur API recherche unifiée:", erreur);
    return NextResponse.json(
      { erreur: "Recherche temporairement indisponible", groupes: [], resultats: [] },
      { status: 503 },
    );
  }
}
