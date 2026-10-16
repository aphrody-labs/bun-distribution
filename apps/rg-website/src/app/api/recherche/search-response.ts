import { NextResponse } from "next/server";
import { grouperParDomaine, rechercherPartout, type ExecuteursSql } from "@rosegriffon/search";

/** Réponse HTTP de la recherche unifiée, avec exécuteur SQL injecté. */
export async function respondreRecherche(requete: Request, executer: ExecuteursSql) {
  const terme = (new URL(requete.url).searchParams.get("q") ?? "").trim();
  if (terme.length < 2) return NextResponse.json({ groupes: [], resultats: [] });

  try {
    const resultats = await rechercherPartout(executer, terme, {
      limiteParSource: 4,
      limiteTotale: 12,
    });
    return NextResponse.json({ groupes: grouperParDomaine(resultats), resultats });
  } catch (erreur) {
    console.error("Erreur API recherche unifiée:", erreur);
    return NextResponse.json(
      { erreur: "Recherche temporairement indisponible", groupes: [], resultats: [] },
      { status: 503 },
    );
  }
}
