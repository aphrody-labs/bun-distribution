// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { evaluateGate, gateThresholdsFromEnv, percentile } from "./eval-aphrody-rag";

const thresholds = { recall5Min: 0.8, p95MaxMs: 8000 };

describe("percentile", () => {
	it("uses the nearest rank", () => {
		const sample = Array.from({ length: 20 }, (_, index) => index + 1);
		expect(percentile(sample, 50)).toBe(10);
		expect(percentile(sample, 95)).toBe(19);
		expect(percentile(sample, 100)).toBe(20);
	});

	it("does not depend on input order and handles empty samples", () => {
		expect(percentile([900, 100, 500], 95)).toBe(900);
		expect(percentile([], 95)).toBe(0);
	});
});

describe("evaluateGate", () => {
	it("passes only when recall, latency and errors all hold", () => {
		expect(evaluateGate({ cases: 172, recall5: 0.8, p95Ms: 7999, errors: 0 }, thresholds)).toEqual({ pass: true, reasons: [] });
	});

	it("reports every failed condition", () => {
		const gate = evaluateGate({ cases: 172, recall5: 0.79, p95Ms: 8000, errors: 2 }, thresholds);
		expect(gate.pass).toBe(false);
		expect(gate.reasons).toHaveLength(3);
	});

	it("rejects an empty evaluation and a NaN recall", () => {
		expect(evaluateGate({ cases: 0, recall5: 1, p95Ms: 1, errors: 0 }, thresholds).pass).toBe(false);
		expect(evaluateGate({ cases: 10, recall5: Number.NaN, p95Ms: 1, errors: 0 }, thresholds).pass).toBe(false);
	});
});

describe("gateThresholdsFromEnv", () => {
	it("defaults to Recall@5 0.8 and p95 8 s", () => {
		expect(gateThresholdsFromEnv({})).toEqual(thresholds);
	});

	it("refuses thresholds outside their domain", () => {
		expect(() => gateThresholdsFromEnv({ RAG_CI_RECALL5_MIN: "1.5" })).toThrow();
		expect(() => gateThresholdsFromEnv({ RAG_CI_P95_MAX_MS: "0" })).toThrow();
	});
});
