import { describe, expect, test } from "bun:test";
import { ADMIN_PUBLIC_SETTINGS, parseAdminPublicSetting } from "./admin-settings-contract";

describe("public admin settings contract", () => {
	test("only verified public consumers are configurable", () => {
		expect(Object.keys(ADMIN_PUBLIC_SETTINGS)).toHaveLength(7);
		expect(parseAdminPublicSetting("DATABASE_URL", "secret").ok).toBe(false);
		expect(parseAdminPublicSetting("oauth_access_token", "secret").ok).toBe(false);
	});
	test("accepts safe text and links", () => {
		expect(parseAdminPublicSetting("home_intro_title", "Rose Griffon").ok).toBe(true);
		expect(parseAdminPublicSetting("home_achillea_link", "/achillea").ok).toBe(true);
		expect(parseAdminPublicSetting("home_achillea_link", "https://rosegriffon.fr/achillea").ok).toBe(true);
	});
	test("rejects unsafe links and oversized text", () => {
		expect(parseAdminPublicSetting("home_achillea_link", "javascript:alert(1)").ok).toBe(false);
		expect(parseAdminPublicSetting("home_achillea_link", "//other.example").ok).toBe(false);
		expect(parseAdminPublicSetting("home_achillea_link", "http://other.example").ok).toBe(false);
		expect(parseAdminPublicSetting("home_intro_text", "x".repeat(4001)).ok).toBe(false);
	});
});
