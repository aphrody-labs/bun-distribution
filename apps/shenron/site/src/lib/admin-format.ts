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
function fmtDate(value: number | string | null | undefined): string {
	if (!value) return "—";
	const d = typeof value === "number" ? new Date(value) : new Date(value);
	if (Number.isNaN(d.getTime())) return "—";
	return d.toLocaleDateString("fr-FR", {
		day: "numeric",
		month: "long",
		year: "numeric",
	});
}

/**
 * Formate une date ISO ou un timestamp en date + heure française.
 * Ex : 1716000000000 → "18 mai 2024 à 14:00"
 */
function fmtDateTime(value: number | string | null | undefined): string {
	if (!value) return "—";
	const d = typeof value === "number" ? new Date(value) : new Date(value);
	if (Number.isNaN(d.getTime())) return "—";
	return d.toLocaleDateString("fr-FR", {
		day: "numeric",
		month: "long",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

/**
 * Formate une durée en millisecondes de manière lisible.
 * Version verbale pour les non-dev (ex : "2 heures 15 min").
 */
function fmtDurationVerbose(ms: number | null | undefined): string {
	if (!ms || !Number.isFinite(ms) || ms < 0) return "—";
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s} seconde${s > 1 ? "s" : ""}`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m} minute${m > 1 ? "s" : ""}`;
	const h = Math.floor(m / 60);
	const rm = m % 60;
	if (h < 24) {
		return rm > 0 ? `${h} heure${h > 1 ? "s" : ""} ${rm} min` : `${h} heure${h > 1 ? "s" : ""}`;
	}
	const jours = Math.floor(h / 24);
	const rh = h % 24;
	return rh > 0
		? `${jours} jour${jours > 1 ? "s" : ""} ${rh}h`
		: `${jours} jour${jours > 1 ? "s" : ""}`;
}

/**
 * Version étendue de formatRelative — inclut les secondes et le pluriel correct.
 * Ex : "il y a 3 minutes", "dans 2 heures", "il y a 1 jour"
 */
function fmtRelativeVerbose(value: number | string | null | undefined): string {
	if (!value) return "—";
	const ts = typeof value === "string" ? new Date(value).getTime() : value;
	if (Number.isNaN(ts)) return "—";
	const diff = Date.now() - ts;
	const abs = Math.abs(diff);
	const past = diff >= 0;

	let label: string;
	if (abs < 10_000) {
		label = "à l'instant";
		return label;
	} else if (abs < 60_000) {
		const sec = Math.floor(abs / 1000);
		label = `${sec} seconde${sec > 1 ? "s" : ""}`;
	} else if (abs < 3_600_000) {
		const min = Math.floor(abs / 60_000);
		label = `${min} minute${min > 1 ? "s" : ""}`;
	} else if (abs < 86_400_000) {
		const h = Math.floor(abs / 3_600_000);
		label = `${h} heure${h > 1 ? "s" : ""}`;
	} else {
		const j = Math.floor(abs / 86_400_000);
		label = `${j} jour${j > 1 ? "s" : ""}`;
	}

	return past ? `il y a ${label}` : `dans ${label}`;
}
