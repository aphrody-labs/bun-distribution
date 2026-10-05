import { expect, test } from "bun:test";
import { getSemanticCache, setSemanticCache, type SemanticCacheDependencies } from "../src/lib/semantic-cache";

const values = new Map<string, string>();
const sortedSets = new Map<string, Map<string, number>>();
const fakeRedis = {
	get: async (key: string) => values.get(key) ?? null,
	set: async (key: string, value: string) => { values.set(key, value); },
	del: async (key: string) => { values.delete(key); },
	zadd: async (key: string, score: number, member: string) => {
		const entries = sortedSets.get(key) ?? new Map<string, number>();
		entries.set(member, score);
		sortedSets.set(key, entries);
	},
	zrange: async (key: string, start: number, stop: number) => {
		const members = [...(sortedSets.get(key) ?? new Map())].toSorted((a, b) => a[1] - b[1]).map(([member]) => member);
		return members.slice(start, stop === -1 ? undefined : stop + 1);
	},
	zcard: async (key: string) => sortedSets.get(key)?.size ?? 0,
	zrem: async (key: string, member: string) => { sortedSets.get(key)?.delete(member); },
	hincrby: async () => 1,
};

test("semantic cache isolates evidence within one bounded persona LRU", async () => {
	const deps: SemanticCacheDependencies = {
		store: fakeRedis as unknown as SemanticCacheDependencies["store"],
		embed: async () => Float32Array.from([1, 0]),
	};
	await setSemanticCache("Où vivent les Nameks ?", "Sur Namek", "whis", "namek-evidence", deps);
	await setSemanticCache("Où vivent les Nameks ?", "Sur Terre", "whis", "earth-evidence", deps);
	const namek = await getSemanticCache("Où vivent les Nameks ?", "whis", "namek-evidence", deps);
	const earth = await getSemanticCache("Où vivent les Nameks ?", "whis", "earth-evidence", deps);
	expect(namek?.answer).toBe("Sur Namek");
	expect(earth?.answer).toBe("Sur Terre");
	expect(sortedSets.size).toBe(1);
	expect([...sortedSets.values()][0]?.size).toBe(2);
});

test("B7: the cache namespace moves to v3 (prompt-version aware scopes)", async () => {
	sortedSets.clear();
	values.clear();
	const deps: SemanticCacheDependencies = {
		store: fakeRedis as unknown as SemanticCacheDependencies["store"],
		embed: async () => Float32Array.from([0, 1]),
	};
	await setSemanticCache("Qui est Goku ?", "Un Saiyan", "whis", "scope", deps);
	expect([...sortedSets.keys()].every((key) => key.endsWith(":v4:lru"))).toBe(true);
	expect([...values.keys()].every((key) => key.includes(":v4:scope:"))).toBe(true);
});

test("the resilient store adapter maps the Bun redis calls to RESP commands", async () => {
	const { resilientSemanticCacheStore } = await import("../src/lib/semantic-cache");
	const sent: string[][] = [];
	const store = resilientSemanticCacheStore({
		send: async (command, args) => {
			sent.push([command, ...args]);
			if (command === "ZRANGE") return ["a", "b"];
			if (command === "ZCARD") return 2;
			if (command === "GET") return null;
			return "OK";
		},
	});
	await store.set("k", "v", "EX", 60);
	expect(await store.zrange("z", -500, -1)).toEqual(["a", "b"]);
	expect(await store.zcard("z")).toBe(2);
	expect(await store.get("k")).toBeNull();
	await store.hincrby("dbz:scache:stats", "hits", 1);
	expect(sent).toEqual([
		["SET", "k", "v", "EX", "60"],
		["ZRANGE", "z", "-500", "-1"],
		["ZCARD", "z"],
		["GET", "k"],
		["HINCRBY", "dbz:scache:stats", "hits", "1"],
	]);
});
