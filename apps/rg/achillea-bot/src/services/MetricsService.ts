import { singleton } from "tsyringe";

type Labels = Record<string, string>;

interface CounterEntry {
	help: string;
	labelNames: string[];
	values: Map<string, number>;
}

interface HistogramEntry {
	help: string;
	buckets: number[];
	labelNames: string[];
	// Map of label-key → { bucketCounts[], sum, count }
	values: Map<string, { counts: number[]; sum: number; count: number }>;
}

interface GaugeEntry {
	help: string;
	labelNames: string[];
	values: Map<string, number>;
}

function labelsToKey(labels?: Labels): string {
	if (!labels || Object.keys(labels).length === 0) return "__default__";
	return Object.entries(labels)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `${k}="${v}"`)
		.join(",");
}

function labelsToPromStr(name: string, labels?: Labels): string {
	if (!labels || Object.keys(labels).length === 0) return name;
	const pairs = Object.entries(labels)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `${k}="${v}"`)
		.join(",");
	return `${name}{${pairs}}`;
}

// MetricsService

@singleton()
export class MetricsService {
	private counters = new Map<string, CounterEntry>();
	private histograms = new Map<string, HistogramEntry>();
	private gauges = new Map<string, GaugeEntry>();

	constructor() {
		// Pre-register standard counters
		this.registerCounter("achillea_sanctions_issued_total", "Total sanctions issued", ["type"]);
		this.registerCounter("achillea_casts_attributed_total", "Total cast attributions", [
			"eventType",
		]);
		this.registerCounter("achillea_elo_matches_total", "Total ELO matches processed", ["mode"]);
		this.registerCounter(
			"achillea_elo_placement_prizes_total",
			"Total tournament placement AP prize payouts",
			["size"]
		);
		this.registerCounter("achillea_http_requests_total", "Total HTTP requests", [
			"method",
			"route",
			"status",
		]);

		// Pre-register standard histogram
		this.registerHistogram(
			"achillea_http_request_duration_seconds",
			"HTTP request duration in seconds",
			[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
			["method", "route"]
		);
	}

	// Counter

	registerCounter(name: string, help: string, labels: string[] = []): void {
		if (!this.counters.has(name)) {
			this.counters.set(name, { help, labelNames: labels, values: new Map() });
		}
	}

	increment(name: string, labels?: Labels, value = 1): void {
		const entry = this.counters.get(name);
		if (!entry) return;
		const key = labelsToKey(labels);
		entry.values.set(key, (entry.values.get(key) ?? 0) + value);
	}

	// Histogram

	registerHistogram(name: string, help: string, buckets: number[], labels: string[] = []): void {
		if (!this.histograms.has(name)) {
			this.histograms.set(name, {
				help,
				buckets: [...buckets].sort((a, b) => a - b),
				labelNames: labels,
				values: new Map(),
			});
		}
	}

	observe(name: string, value: number, labels?: Labels): void {
		const entry = this.histograms.get(name);
		if (!entry) return;
		const key = labelsToKey(labels);
		if (!entry.values.has(key)) {
			entry.values.set(key, {
				counts: Array.from({ length: entry.buckets.length }, () => 0) as number[],
				sum: 0,
				count: 0,
			});
		}
		const slot = entry.values.get(key)!;
		slot.sum += value;
		slot.count += 1;
		for (let i = 0; i < entry.buckets.length; i++) {
			if (value <= entry.buckets[i]) slot.counts[i]++;
		}
	}

	// Gauge

	registerGauge(name: string, help: string, labels: string[] = []): void {
		if (!this.gauges.has(name)) {
			this.gauges.set(name, { help, labelNames: labels, values: new Map() });
		}
	}

	setGauge(name: string, value: number, labels?: Labels): void {
		const entry = this.gauges.get(name);
		if (!entry) return;
		entry.values.set(labelsToKey(labels), value);
	}

	incGauge(name: string, labels?: Labels, delta = 1): void {
		const entry = this.gauges.get(name);
		if (!entry) return;
		const key = labelsToKey(labels);
		entry.values.set(key, (entry.values.get(key) ?? 0) + delta);
	}

	decGauge(name: string, labels?: Labels, delta = 1): void {
		this.incGauge(name, labels, -delta);
	}

	// Prometheus text exposition

	async render(): Promise<string> {
		const lines: string[] = [];

		for (const [name, entry] of this.counters) {
			lines.push(`# HELP ${name} ${entry.help}`);
			lines.push(`# TYPE ${name} counter`);
			for (const [key, val] of entry.values) {
				const labelStr = key === "__default__" ? name : `${name}{${key}}`;
				lines.push(`${labelStr} ${val}`);
			}
		}

		for (const [name, entry] of this.histograms) {
			lines.push(`# HELP ${name} ${entry.help}`);
			lines.push(`# TYPE ${name} histogram`);
			for (const [key, slot] of entry.values) {
				const prefix = key === "__default__" ? "" : `${key},`;
				// counts[] already cumulative (observe increments all matching buckets)
				for (let i = 0; i < entry.buckets.length; i++) {
					const le = entry.buckets[i];
					lines.push(`${name}_bucket{${prefix}le="${le}"} ${slot.counts[i]}`);
				}
				lines.push(`${name}_bucket{${prefix}le="+Inf"} ${slot.count}`);
				lines.push(
					`${name}_sum{${key === "__default__" ? "" : key}} ${slot.sum}`.replace(/\{\}/, "")
				);
				lines.push(
					`${name}_count{${key === "__default__" ? "" : key}} ${slot.count}`.replace(/\{\}/, "")
				);
			}
		}

		for (const [name, entry] of this.gauges) {
			lines.push(`# HELP ${name} ${entry.help}`);
			lines.push(`# TYPE ${name} gauge`);
			for (const [key, val] of entry.values) {
				const labelStr = key === "__default__" ? name : `${name}{${key}}`;
				lines.push(`${labelStr} ${val}`);
			}
		}

		return `${lines.join("\n")}\n`;
	}
}
