import { joinApiUrl } from "@rosegriffon/achillea-core";

export { joinApiUrl };

/** Joint un chemin API avec l'URL de base Achilléa configurée */
export function apiUrl(path: string): string {
  let base = "";
  try {
    base = process.env.NEXT_PUBLIC_ACHILLEA_API_URL ?? "";
  } catch {
    // The optional build-time variable is absent from this browser bundle.
  }
  return joinApiUrl(base, path);
}
