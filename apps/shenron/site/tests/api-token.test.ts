/**
 * Contrat du jeton Bearer partagé par les API d'administration.
 *
 * Les tests de handlers remplacent volontairement ce module par un mock. Cette
 * suite couvre donc le vrai parseur et le repli de configuration, sans jamais
 * lire un fichier .env ou un secret de production.
 */
import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const savedDatabooks = process.env.DATABOOKS_API_TOKEN;
const savedAdmin = process.env.SHENRON_ADMIN_TOKEN;

const restore = () => {
	if (savedDatabooks === undefined) delete process.env.DATABOOKS_API_TOKEN;
	else process.env.DATABOOKS_API_TOKEN = savedDatabooks;
	if (savedAdmin === undefined) delete process.env.SHENRON_ADMIN_TOKEN;
	else process.env.SHENRON_ADMIN_TOKEN = savedAdmin;
};

afterEach(restore);

const { expectedApiToken, hasValidApiToken } = await import("../src/lib/api-token");

describe("jeton Bearer des API admin", () => {
	test("accepte le SHENRON_ADMIN_TOKEN avec une casse Bearer et des espaces tolérants", () => {
		delete process.env.DATABOOKS_API_TOKEN;
		process.env.SHENRON_ADMIN_TOKEN = "admin-token-123456";

		expect(expectedApiToken()).toBe("admin-token-123456");
		expect(hasValidApiToken(new Request("http://test", { headers: { authorization: " bearer   admin-token-123456 " } }))).toBe(true);
	});

	test("préfère le jeton spécialisé DATABOOKS_API_TOKEN", () => {
		process.env.DATABOOKS_API_TOKEN = "databooks-token-123456";
		process.env.SHENRON_ADMIN_TOKEN = "admin-token-123456";

		expect(hasValidApiToken(new Request("http://test", { headers: { authorization: "Bearer databooks-token-123456" } }))).toBe(true);
		expect(hasValidApiToken(new Request("http://test", { headers: { authorization: "Bearer admin-token-123456" } }))).toBe(false);
	});

	test("refuse un header mal formé, un secret erroné et une configuration absente ou trop courte", () => {
		process.env.SHENRON_ADMIN_TOKEN = "admin-token-123456";
		expect(hasValidApiToken(new Request("http://test", { headers: { authorization: "Basic admin-token-123456" } }))).toBe(false);
		expect(hasValidApiToken(new Request("http://test", { headers: { authorization: "Bearer incorrect-token-123" } }))).toBe(false);

		delete process.env.SHENRON_ADMIN_TOKEN;
		expect(expectedApiToken()).toBeNull();
		process.env.SHENRON_ADMIN_TOKEN = "short";
		expect(expectedApiToken()).toBeNull();
	});
});
