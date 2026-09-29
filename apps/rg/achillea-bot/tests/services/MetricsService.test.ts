/**
 * Tests MetricsService — C-3 observabilité
 *
 * Run: bun test tests/services/MetricsService.test.ts
 *
 * Pure unit tests — no DI container, no DB required.
 */

import "reflect-metadata";

import { beforeEach, describe, expect, mock, test } from "bun:test";
// Import MetricsService
import { MetricsService } from "../../src/services/MetricsService";

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("MetricsService", () => {
	let svc: InstanceType<typeof MetricsService>;

	beforeEach(() => {
		svc = new MetricsService();
	});

	// -------------------------------------------------------------------------
	// 1. Counter increment
	// -------------------------------------------------------------------------

	test("counter increments and accumulates value", () => {
		svc.registerCounter("test_counter_total", "A test counter");
		svc.increment("test_counter_total");
		svc.increment("test_counter_total");
		svc.increment("test_counter_total", undefined, 3);

		// Access internal state indirectly via render
		return svc.render().then((output) => {
			expect(output).toContain("test_counter_total 5");
		});
	});

	// -------------------------------------------------------------------------
	// 2. Counter with labels
	// -------------------------------------------------------------------------

	test("counter with labels generates distinct series", () => {
		svc.registerCounter("label_counter_total", "Labelled counter", ["type"]);
		svc.increment("label_counter_total", { type: "ban" });
		svc.increment("label_counter_total", { type: "ban" });
		svc.increment("label_counter_total", { type: "warn" });

		return svc.render().then((output) => {
			expect(output).toContain('label_counter_total{type="ban"} 2');
			expect(output).toContain('label_counter_total{type="warn"} 1');
		});
	});

	// -------------------------------------------------------------------------
	// 3. Histogram observe
	// -------------------------------------------------------------------------

	test("histogram observe populates buckets, sum and count", () => {
		svc.registerHistogram("test_duration_seconds", "Duration histogram", [0.1, 0.5, 1.0]);
		svc.observe("test_duration_seconds", 0.05);
		svc.observe("test_duration_seconds", 0.3);
		svc.observe("test_duration_seconds", 0.8);

		return svc.render().then((output) => {
			// 0.05 fits in le=0.1 → cumulative 1; 0.3 fits le=0.5 → cumulative 2; 0.8 fits le=1 → 3
			expect(output).toContain('test_duration_seconds_bucket{le="0.1"} 1');
			expect(output).toContain('test_duration_seconds_bucket{le="0.5"} 2');
			expect(output).toContain('test_duration_seconds_bucket{le="1"} 3');
			expect(output).toContain('test_duration_seconds_bucket{le="+Inf"} 3');
			expect(output).toContain("test_duration_seconds_count 3");
		});
	});

	// -------------------------------------------------------------------------
	// 4. render() produces valid Prometheus text format
	// -------------------------------------------------------------------------

	test("render() output has HELP and TYPE lines for each metric", () => {
		return svc.render().then((output) => {
			// Pre-registered counters
			expect(output).toContain("# HELP achillea_sanctions_issued_total");
			expect(output).toContain("# TYPE achillea_sanctions_issued_total counter");
			expect(output).toContain("# HELP achillea_http_requests_total");
			expect(output).toContain("# TYPE achillea_http_requests_total counter");
			// Pre-registered histogram
			expect(output).toContain("# HELP achillea_http_request_duration_seconds");
			expect(output).toContain("# TYPE achillea_http_request_duration_seconds histogram");
			// Output ends with newline
			expect(output.endsWith("\n")).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// 5. Gauge set / inc / dec
	// -------------------------------------------------------------------------

	test("gauge set, inc and dec work correctly", () => {
		svc.registerGauge("test_queue_size", "Queue size gauge");
		svc.setGauge("test_queue_size", 10);
		svc.incGauge("test_queue_size");
		svc.decGauge("test_queue_size", undefined, 3);

		return svc.render().then((output) => {
			expect(output).toContain("# TYPE test_queue_size gauge");
			expect(output).toContain("test_queue_size 8");
		});
	});

	// -------------------------------------------------------------------------
	// 6. Pre-registered metrics exist even with no observations
	// -------------------------------------------------------------------------

	test("pre-registered counters appear in render without observations", () => {
		return svc.render().then((output) => {
			expect(output).toContain("# TYPE achillea_elo_matches_total counter");
			expect(output).toContain("# TYPE achillea_casts_attributed_total counter");
		});
	});
});
