// SPDX-License-Identifier: Apache-2.0
/** Shenron consumer for Aphrody's Rust MPEG-7 frame index and search. */
import { runAphrodyCli, type AphrodyCliOptions } from "./cli";

export interface AphrodyFrameVector {
	hash: string;
	vector: number[];
}

export interface AphrodyFrameMatch {
	title: string;
	episode?: number | null;
	season?: number | null;
	fromMs: number;
	atMs: number;
	toMs: number;
	similarity: number;
	source: string;
	anilist: number;
	preview: { image: string; video: string };
}

export interface AphrodyFrameSearch {
	origin: string;
	matches: AphrodyFrameMatch[];
	quota?: { used: number; total: number };
}

export interface AphrodyFramesSearchOptions {
	mode?: "--local" | "--remote" | "--auto";
	limit?: number;
	anilistId?: number;
	at?: string;
}

export interface AphrodyFramesStats {
	path: string;
	media: number;
	frames: number;
	durationMs: number;
}

export class AphrodyFramesClient {
	constructor(private readonly defaultOptions: Omit<AphrodyCliOptions, "json"> = {}) {}

	async vector(path: string, options?: Omit<AphrodyCliOptions, "json">): Promise<AphrodyFrameVector> {
		const input = required(path, "Image or video path");
		const result = await runAphrodyCli<AphrodyFrameVector>(["web", "frames", "vector", input, "--json"], { ...this.defaultOptions, ...options, json: true });
		return validate(result, isVector, "frame vector");
	}

	async search(path: string, search: AphrodyFramesSearchOptions = {}, options?: Omit<AphrodyCliOptions, "json">): Promise<AphrodyFrameSearch> {
		const args = ["web", "frames", "search", required(path, "Image or video path"), search.mode ?? "--local"];
		if (search.limit !== undefined) args.push("--limit", String(positiveInteger(search.limit, "limit")));
		if (search.anilistId !== undefined) args.push("--anilist-id", String(positiveInteger(search.anilistId, "AniList ID")));
		if (search.at) args.push("--at", search.at);
		args.push("--json");
		const result = await runAphrodyCli<AphrodyFrameSearch>(args, { ...this.defaultOptions, ...options, json: true });
		return validate(result, isSearch, "frame search");
	}

	async stats(options?: Omit<AphrodyCliOptions, "json">): Promise<AphrodyFramesStats> {
		const result = await runAphrodyCli<AphrodyFramesStats>(["web", "frames", "stats", "--json"], { ...this.defaultOptions, ...options, json: true });
		return validate(result, isStats, "frame stats");
	}

	async list(filter?: string, options?: Omit<AphrodyCliOptions, "json">): Promise<unknown[]> {
		const args = ["web", "frames", "list"];
		if (filter?.trim()) args.push(filter.trim());
		args.push("--json");
		const result = await runAphrodyCli<unknown[]>(args, { ...this.defaultOptions, ...options, json: true });
		return validate(result, (data): data is unknown[] => Array.isArray(data) && data.every(isMediaRow), "frame list");
	}

	async quota(options?: Omit<AphrodyCliOptions, "json">): Promise<{ used: number; total: number }> {
		const result = await runAphrodyCli<unknown>(["web", "frames", "quota", "--json"], { ...this.defaultOptions, ...options, json: true });
		const raw = value(result);
		if (isQuota(raw)) return raw;
		if (record(raw) && typeof raw.quota === "number" && typeof raw.remaining === "number") {
			return { used: Math.max(0, raw.quota - raw.remaining), total: raw.quota };
		}
		throw new Error("aphrody returned invalid trace.moe quota");
	}
}

function required(value: string, name: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new Error(`${name} is required`);
	return trimmed;
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
	return value;
}

function value<T>(result: Awaited<ReturnType<typeof runAphrodyCli<T>>>): T {
	if (result.kind === "exit" && result.ok) return result.data as T;
	if (result.kind === "exit") throw new Error(`aphrody exited ${result.code}: ${result.stderr.trim()}`);
	if (result.kind === "timeout") throw new Error(`aphrody timed out after ${result.timeoutMs} ms`);
	if (result.kind === "invalid_json") throw new Error(`aphrody returned invalid JSON: ${result.error}`);
	throw new Error(result.message);
}

function validate<T>(result: Awaited<ReturnType<typeof runAphrodyCli<T>>>, predicate: (data: unknown) => data is T, label: string): T {
	const data: unknown = value(result);
	if (!predicate(data)) throw new Error(`aphrody returned invalid ${label}`);
	return data;
}

function isVector(data: unknown): data is AphrodyFrameVector {
	if (!record(data) || typeof data.hash !== "string" || !Array.isArray(data.vector)) return false;
	return data.vector.length === 33 && data.vector.every((value) => Number.isInteger(value) && value >= 0 && value <= 255);
}

function isSearch(data: unknown): data is AphrodyFrameSearch {
	return record(data) && typeof data.origin === "string" && Array.isArray(data.matches) && data.matches.every(isMatch);
}

function isMatch(value: unknown): value is AphrodyFrameMatch {
	return record(value) && typeof value.title === "string" && typeof value.fromMs === "number" && typeof value.atMs === "number" && typeof value.toMs === "number" && typeof value.similarity === "number" && typeof value.source === "string" && typeof value.anilist === "number" && record(value.preview) && typeof value.preview.image === "string" && typeof value.preview.video === "string";
}

function isStats(data: unknown): data is AphrodyFramesStats {
	return record(data) && typeof data.path === "string" && typeof data.media === "number" && typeof data.frames === "number" && typeof data.durationMs === "number";
}

function isMediaRow(data: unknown): boolean {
	return record(data) && typeof data.id === "number" && typeof data.source === "string" && typeof data.title === "string" && typeof data.durationMs === "number" && typeof data.fps === "number" && typeof data.frameCount === "number";
}

function isQuota(data: unknown): data is { used: number; total: number } {
	return record(data) && typeof data.used === "number" && typeof data.total === "number";
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
