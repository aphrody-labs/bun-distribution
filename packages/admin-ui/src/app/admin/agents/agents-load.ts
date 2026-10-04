// SPDX-License-Identifier: Apache-2.0
// Lecture d'une source de /admin/agents sans masquer une panne. Un `catch(() => [])` rendait « aucune
// clé » et « aucun appel » pour une base PostgreSQL injoignable : l'écran affirmait un état faux.

export type LoadState<T> = { ok: true; data: T } | { ok: false; code: string | null };

/** Code court de l'erreur (SQLSTATE `08006`, errno `ECONNREFUSED`…), jamais son message ni sa cause. */
const SAFE_CODE = /^[A-Za-z0-9_]{3,24}$/;

/**
 * Le message d'un pilote de base peut contenir l'hôte, l'utilisateur ou un fragment de requête : il
 * reste dans les journaux serveur. Seul un code court est affiché, en remontant la chaîne `cause`
 * (Drizzle enveloppe l'erreur du pilote).
 */
export function describeLoadFailure(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && SAFE_CODE.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export async function loadSource<T>(
  source: string,
  load: () => Promise<T>,
  log: (message: string, error: unknown) => void = console.error,
): Promise<LoadState<T>> {
  try {
    return { ok: true, data: await load() };
  } catch (error) {
    log(`[admin/agents] lecture « ${source} » impossible`, error);
    return { ok: false, code: describeLoadFailure(error) };
  }
}
