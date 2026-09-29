export { cn } from "@shenron/ui/lib/utils";

export function formatBytes(bytes: number): string {
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
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ${m % 60}m`;
	return `${Math.floor(h / 24)}j ${h % 24}h`;
}

export function formatRelative(ms: number | null): string {
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
