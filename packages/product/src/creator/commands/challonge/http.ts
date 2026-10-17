/** Petits utilitaires HTTP partagés par les clients Challonge et Discord (aucune dépendance). */

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Remplace chaque secret connu par `***` (les secrets trop courts sont ignorés pour éviter les faux positifs). */
export function redact(text: string, secrets: readonly (string | undefined)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join("***");
  }
  return out;
}

/** Backoff exponentiel avec gigue : la tentative 0 attend environ `baseMs`, plafonné à `capMs`. */
export function backoffMs(attempt: number, random: () => number, baseMs = 1000, capMs = 30_000): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.round(ceiling / 2 + (ceiling / 2) * random());
}

/** Valeur de `Retry-After` (secondes ou date HTTP) en millisecondes, ou `undefined`. */
export function retryAfterMs(res: Response, now = Date.now()): number | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** Libère le corps d'une réponse qu'on n'exploite pas (évite de garder la connexion ouverte). */
export async function drain(res: Response): Promise<void> {
  try {
    await res.arrayBuffer();
  } catch {
    // corps déjà consommé ou flux interrompu : sans importance
  }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
