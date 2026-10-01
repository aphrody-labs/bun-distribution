// SPDX-License-Identifier: Apache-2.0
import { tempPath } from "@aphrody/paths";
import { beforeEach, describe, expect, test } from "bun:test";
import {
	DATA_PATH_ENV,
	resetEphemeralWarnings,
	resolveDataPath,
	warnIfEphemeral,
} from "../src/paths";

beforeEach(() => resetEphemeralWarnings());

describe("DATA_PATH_ENV", () => {
	test("documented variables per key", () => {
		expect(DATA_PATH_ENV).toEqual({
			ragGold: ["RAG_GOLD_PATH", "RAG_GOLD"],
			adminDocsDir: ["SHENRON_ADMIN_DOCS_DIR"],
			coordDir: ["A2A_COORD_DIR", "COORD_DIR"],
			databooksFreezeFile: ["DATABOOKS_FREEZE_FILE"],
			ragLexique: ["RAG_LEXIQUE"],
		});
	});
});

describe("resolveDataPath", () => {
	test("first set alias wins", () => {
		const env = { RAG_GOLD_PATH: "/srv/shared/rag-gold.jsonl", RAG_GOLD: tempPath("other.jsonl") };
		expect(resolveDataPath("ragGold", { env, legacyDefault: "tests/rag-gold.jsonl" })).toEqual({
			key: "ragGold",
			path: "/srv/shared/rag-gold.jsonl",
			source: "env",
			envName: "RAG_GOLD_PATH",
		});
		const coord = resolveDataPath("coordDir", {
			env: { A2A_COORD_DIR: " ", COORD_DIR: "/srv/coord" },
			legacyDefault: ".coord",
		});
		expect(coord).toMatchObject({ path: "/srv/coord", envName: "COORD_DIR", source: "env" });
	});

	test("legacy default is passed through byte for byte", () => {
		const legacyDefault = "  ./data/Rägistre des gels.json  ";
		const resolved = resolveDataPath("databooksFreezeFile", { env: {}, legacyDefault });
		expect(resolved).toEqual({
			key: "databooksFreezeFile",
			path: legacyDefault,
			source: "legacy-default",
			envName: null,
		});
		expect(resolved.path === legacyDefault).toBe(true);
	});
});

describe("warnIfEphemeral", () => {
	test("warns once per key in production, only for legacy defaults", () => {
		const logs: string[] = [];
		const log = (message: string) => logs.push(message);
		const production = { NODE_ENV: "production" };
		const lexique = resolveDataPath("ragLexique", {
			env: production,
			legacyDefault: "data/rag/lexique.json",
		});
		warnIfEphemeral(lexique, production, log);
		warnIfEphemeral(lexique, production, log);
		expect(logs).toHaveLength(1);
		expect(logs[0]).toContain("RAG_LEXIQUE");

		const fromEnv = resolveDataPath("adminDocsDir", {
			env: { SHENRON_ADMIN_DOCS_DIR: "/srv/docs" },
			legacyDefault: "docs",
		});
		warnIfEphemeral(fromEnv, production, log);
		expect(logs).toHaveLength(1);

		const other = resolveDataPath("coordDir", { env: production, legacyDefault: ".coord" });
		warnIfEphemeral(other, production, log);
		expect(logs).toHaveLength(2);
	});

	test("never warns outside production", () => {
		const logs: string[] = [];
		const p = resolveDataPath("ragGold", { env: {}, legacyDefault: "tests/rag-gold.jsonl" });
		warnIfEphemeral(p, { NODE_ENV: "development" }, (m) => logs.push(m));
		warnIfEphemeral(p, {}, (m) => logs.push(m));
		expect(logs).toEqual([]);
	});
});
