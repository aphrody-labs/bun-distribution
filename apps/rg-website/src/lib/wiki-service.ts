import "server-only";

import "@/lib/azalee-runtime";

import { wikiService as service } from "@rosegriffon/azalee/wiki/service";

/**
 * Façade serveur du service wiki (personnages, techniques, objets, auras, tactiques, galerie, passives).
 *
 * Façade Next au-dessus de `@rosegriffon/azalee/wiki/service` : la logique vit dans
 * la bibliothèque (utilisable en CLI et en sidecar Tauri), ce fichier n'ajoute
 * que la garde `server-only`, l'injection du client de données et un cache
 * mémoire des listes.
 */

export * from "@rosegriffon/azalee/wiki/service";

/**
 * Les listes filtrées (`?element=…&page=…`) restent rendues à la requête : elles
 * lisent `searchParams` et ne peuvent pas être ISR. Elles interrogent le miroir
 * Neon, qui s'endort après 5 min d'inactivité et dont le plan gratuit ne compte
 * que 100 CU-heures par mois : sans cache, chaque visite réveillait le calcul.
 *
 * Une instance Fluid sert de nombreuses requêtes : chaque combinaison de filtres
 * est gardée 10 min en mémoire (64 au plus, la plus ancienne sort d'abord). Les
 * données de jeu sont publiques et identiques pour tous ; les résultats partagés
 * sont en lecture seule. Voir docs/aphrody/reference/infra/rg-free-tier-allocation.md.
 */
const DUREE_MS = 10 * 60_000;
const ENTREES_MAX = 64;
const memoire = new Map<string, { depuis: number; valeur: Promise<unknown> }>();

function enCache<A extends unknown[], R>(nom: string, lire: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args: A) => {
    const cle = `${nom}:${JSON.stringify(args)}`;
    const trouve = memoire.get(cle);
    memoire.delete(cle);
    if (trouve && Date.now() - trouve.depuis < DUREE_MS) {
      memoire.set(cle, trouve);
      return trouve.valeur as Promise<R>;
    }
    const valeur = lire(...args);
    memoire.set(cle, { depuis: Date.now(), valeur });
    valeur.catch(() => memoire.delete(cle));
    while (memoire.size > ENTREES_MAX) memoire.delete(memoire.keys().next().value as string);
    return valeur;
  };
}

export const wikiService: typeof service = {
  ...service,
  getAurasList: enCache("auras", service.getAurasList.bind(service)),
  getCharactersList: enCache("characters", service.getCharactersList.bind(service)),
  getCoordinatorsList: enCache("coordinators", service.getCoordinatorsList.bind(service)),
  getGalleryCategoryCounts: enCache("gallery-counts", service.getGalleryCategoryCounts.bind(service)),
  getGalleryList: enCache("gallery", service.getGalleryList.bind(service)),
  getItemsList: enCache("items", service.getItemsList.bind(service)),
  getPassivesList: enCache("passives", service.getPassivesList.bind(service)),
  getSkillsList: enCache("skills", service.getSkillsList.bind(service)),
  getTacticsList: enCache("tactics", service.getTacticsList.bind(service)),
};
