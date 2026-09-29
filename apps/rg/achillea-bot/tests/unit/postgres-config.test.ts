import { describe, expect, test } from "bun:test";

import { resolvePostgresConnection } from "../../src/configs/postgres";

describe("resolvePostgresConnection", () => {
	test("lit une DATABASE_URL Supabase et impose TLS", () => {
		const connection = resolvePostgresConnection({
			connectionUrl:
				"postgresql://postgres.project:p%40ss@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require",
		});

		expect(connection).toEqual({
			host: "aws-0-eu-west-1.pooler.supabase.com",
			port: 6543,
			database: "postgres",
			user: "postgres.project",
			password: "p@ss",
			tls: true,
		});
	});

	test("DATABASE_URL reste prioritaire sur les variables historiques", () => {
		const connection = resolvePostgresConnection({
			connectionUrl: "postgresql://url-user:url-pass@db.example.test:5433/url-db",
			host: "legacy.example.test",
			user: "legacy-user",
			database: "legacy-db",
		});

		expect(connection.host).toBe("db.example.test");
		expect(connection.user).toBe("url-user");
		expect(connection.tls).toBe(false);
	});

	test("refuse explicitement de désactiver TLS sur Supabase", () => {
		expect(() =>
			resolvePostgresConnection({
				connectionUrl:
					"postgresql://postgres:secret@db.project.supabase.co/postgres?sslmode=disable",
			})
		).toThrow("TLS ne peut pas être désactivé");
	});

	test("valide le protocole et les champs obligatoires", () => {
		expect(() =>
			resolvePostgresConnection({ connectionUrl: "https://db.example.test/postgres" })
		).toThrow("postgres:// ou postgresql://");
		expect(() => resolvePostgresConnection({ host: "db.example.test" })).toThrow(
			"Configuration PostgreSQL absente"
		);
	});
});
