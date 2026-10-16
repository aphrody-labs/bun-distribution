/**
 * Helpers de formatage partagés par les pages admin (portés du dashboard bot).
 * `cn` vit déjà dans @/lib/utils — ne pas redéfinir ici.
 */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let n = bytes / 1024;
  for (const u of units) {
    if (n < 1024) return `${n.toFixed(1)} ${u}`;
    n /= 1024;
  }
  return `${n.toFixed(1)} TiB`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}j ${h % 24}h`;
}

export function formatRelative(ms: number | null | undefined): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const past = diff > 0;
  const formatted =
    abs < 60_000
      ? `${Math.floor(abs / 1000)}s`
      : abs < 3_600_000
        ? `${Math.floor(abs / 60_000)}m`
        : abs < 86_400_000
          ? `${Math.floor(abs / 3_600_000)}h`
          : `${Math.floor(abs / 86_400_000)}j`;
  return past ? `il y a ${formatted}` : `dans ${formatted}`;
}

export function fmtNum(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("fr-FR");
}

/**
 * Formate une date ISO ou un timestamp en date lisible française.
 * Ex : 1716000000000 → "18 mai 2024"
 */

/**
 * Formate une date ISO ou un timestamp en date + heure française.
 * Ex : 1716000000000 → "18 mai 2024 à 14:00"
 */

/**
 * Formate une durée en millisecondes de manière lisible.
 * Version verbale pour les non-dev (ex : "2 heures 15 min").
 */

/**
 * Version étendue de formatRelative — inclut les secondes et le pluriel correct.
 * Ex : "il y a 3 minutes", "dans 2 heures", "il y a 1 jour"
 */
