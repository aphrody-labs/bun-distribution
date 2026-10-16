/**
 * Construction d'URL d'API — logique pure, aucune dépendance à un client HTTP.
 *
 * Extraite de l'intercepteur Angular : la même règle de jointure doit valoir
 * pour `fetch` côté Next.js, pour Bun, et pour un client natif.
 */

const API_PATH = "/api";

/**
 * Joint une base d'API et un chemin en conservant une seule frontière `/api`.
 *
 * `joinApiUrl("https://x.fr/api", "/api/users")` → `https://x.fr/api/users`
 * (et non `.../api/api/users`). Un chemin absolu est renvoyé tel quel.
 */
export function joinApiUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//iu.test(path)) return path;

  const base = baseUrl.replace(/\/$/u, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!base) return normalizedPath;

  const basePath = /^https?:\/\//iu.test(base) ? new URL(base).pathname.replace(/\/$/u, "") : base;
  const alreadyHasApiBoundary =
    (basePath === API_PATH || basePath.endsWith(API_PATH)) &&
    (normalizedPath === API_PATH || normalizedPath.startsWith(`${API_PATH}/`));
  const suffix = alreadyHasApiBoundary ? normalizedPath.slice(API_PATH.length) : normalizedPath;

  return `${base}${suffix}`;
}

export type QueryValue = string | number | boolean | null | undefined;

/**
 * Sérialise un objet en query string, en omettant `null`/`undefined`/`""`.
 * Les tableaux produisent une clé répétée (`?tag=a&tag=b`).
 */
export function buildQueryString(params: Record<string, QueryValue | readonly QueryValue[]>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item === null || item === undefined || item === "") continue;
      search.append(key, String(item));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** Concatène chemin et paramètres (`/users` + `{page:2}` → `/users?page=2`). */
export function withQuery(path: string, params?: Record<string, QueryValue | readonly QueryValue[]>): string {
  if (!params) return path;
  return `${path}${buildQueryString(params)}`;
}
