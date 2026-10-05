import { beforeAll, describe, expect, it, mock } from "bun:test";
import * as dbConfig from "@shenron/db/config";

mock.module("server-only", () => ({}));

type DbModule = typeof import("../src/lib/db");
let mod: DbModule;

beforeAll(async () => {
	// postgres-js connects lazily: importing the module opens no socket.
	process.env.DATABASE_URL ??= "postgres://user:pass@127.0.0.1:5432/shenron_test";
	mod = await import("../src/lib/db");
});

describe("apps/shenron/site/src/lib/db facade", () => {
	it("exports exactly the historical names", () => {
		expect(Object.keys(mod).toSorted()).toEqual(
			[
				"DB_APPLICATION_NAME",
				"DEFAULT_POOL_MAX",
				"POOL_MAX_CEILING",
				"closeDb",
				"db",
				"resolveDatabaseUrl",
				"resolvePoolMax",
				"schema",
			].toSorted()
		);
		expect(mod.DB_APPLICATION_NAME).toBe("shenron-site");
	});

	it("re-exports the @shenron/db/config helpers unchanged", () => {
		expect(mod.resolveDatabaseUrl).toBe(dbConfig.resolveDatabaseUrl);
		expect(mod.resolvePoolMax).toBe(dbConfig.resolvePoolMax);
		expect(mod.DEFAULT_POOL_MAX).toBe(4);
		expect(mod.POOL_MAX_CEILING).toBe(dbConfig.POOL_MAX_CEILING);
	});
});

describe("closeDb", () => {
	it("is idempotent", async () => {
		await mod.closeDb(0);
		await mod.closeDb(0);
	});
});
