import type { SignupPoint } from "../_components/signups-chart";

/**
 * Regroupe les créations de compte par jour UTC pour le graphique admin.
 *
 * Le client PostgreSQL retourne les `timestamptz` sous forme de `Date`, tandis
 * que d'anciens adaptateurs renvoyaient des chaînes ISO. Accepter les deux
 * formes évite qu'un changement de transport fasse tomber tout le dashboard.
 */
export function buildDailySignups(
  rows: readonly { created_at: Date | string | null }[],
  now = new Date(),
): SignupPoint[] {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const buckets = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - i);
    buckets.set(day.toISOString().slice(0, 10), 0);
  }

  for (const row of rows) {
    if (!row.created_at) continue;
    const date = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
    if (Number.isNaN(date.getTime())) continue;
    const key = date.toISOString().slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return Array.from(buckets, ([date, count]) => ({ count, date }));
}
