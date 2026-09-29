import { afterEach, describe, expect, test } from "bun:test";
import "../../server";

import { creatorClient, userClient } from "../../client";

import { QueryBuilder, Type } from "../../../v2";
import { PatreonOauthClient } from "../../../rest/v2/oauth2/client";

afterEach(() => {
	creatorClient.oauth.options.validateToken = false;
	creatorClient.oauth.options.validateScopes = false;
	creatorClient.oauth.cachedToken = {
		access_token: "access_token",
		refresh_token: "refresh_token",
	};
	creatorClient.name = null;
	userClient.oauth.options.validateScopes = false;
	userClient.oauth.options.scopes = [];
	userClient.oauth.options.redirectUri = "https://ghostrider-05.com/";
});

describe("oauth methods", () => {
	test("pagination", async () => {
		const paginator = creatorClient.paginateOauth2(
			"/webhooks",
			QueryBuilder.webhooks.setRequestOptions({ count: 1 })
		);
		let total: number | null = null;

		while (true) {
			const page = await paginator.next();
			if (page.done) {
				// TODO: test with cache
				// expect(page.value).toEqual(total)
				break;
			}

			expect(page.value.data.every((d) => d.type === Type.Webhook)).toBeTruthy();

			// TODO: test with cache
			// expect(page.value.data.length).toEqual(1)
			total ??= page.value.meta.pagination.total;

			// TODO: test if data is unique
		}
	});
});

describe("oauth client", () => {
	test("client options", () => {
		expect(creatorClient.name).toBeNull();
		expect(creatorClient.oauth.userAgent).toBeTypeOf("string");

		creatorClient.name = "new";
		expect(creatorClient.name).toEqual("new");
		expect(creatorClient.oauth["rest"].name).toEqual("new");
	});

	test("util: is expired", () => {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		expect(PatreonOauthClient["isExpired"](creatorClient.oauth.cachedToken!)).toBeFalsy();

		expect(
			PatreonOauthClient["isExpired"](<never>{
				expires_in_epoch: (Date.now() + 86000).toString(),
			})
		);
	});

	test("util: to stored", () => {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		expect(PatreonOauthClient["toStored"](creatorClient.oauth.cachedToken!)).toEqual(
			creatorClient.oauth.cachedToken
		);

		const diff = Math.abs(
			parseInt(PatreonOauthClient["toStored"](<never>{ expires_in: "600" }).expires_in_epoch) -
			(Date.now() + 600_000)
		);
		expect(diff).toBeLessThan(100);
	});

	test("uri", () => {
		expect(userClient.oauth.oauthUri).toBeTypeOf("string");

		expect(
			userClient.oauth.createOauthUri({
				scopes: [],
				state: "state",
			})
		).toBeTypeOf("string");

		userClient.oauth.options.redirectUri = undefined;
		expect(() =>
			userClient.oauth.createOauthUri({
				scopes: [],
			})
		).toThrow();
	});

	test("validate scopes", () => {
		// no option set
		expect(() =>
			creatorClient.oauth["validateScopes"]("/webhooks", QueryBuilder.webhooks)
		).not.toThrowError();
		creatorClient.oauth.options.validateScopes = true;
		expect(() =>
			creatorClient.oauth["validateScopes"]("/webhooks", QueryBuilder.webhooks)
		).not.toThrowError();

		// const userClient = createTestClient('user', async () => new Response())
		expect(() =>
			userClient.oauth["validateScopes"]("/webhooks", QueryBuilder.webhooks)
		).not.toThrowError();

		userClient.oauth.options.validateScopes = true;
		expect(() =>
			userClient.oauth["validateScopes"]("/webhooks", QueryBuilder.webhooks)
		).toThrowError();

		userClient.oauth.options.scopes = ["w:campaigns.webhook"];
		expect(() =>
			userClient.oauth["validateScopes"]("/webhooks", QueryBuilder.webhooks)
		).not.toThrowError();
	});

	test("validate token", async () => {
		creatorClient.oauth.options.validateToken = true;

		expect(
			async () => await PatreonOauthClient["validateToken"](creatorClient.oauth, undefined)
		).not.toThrowError();
		expect(await PatreonOauthClient["validateToken"](creatorClient.oauth)).toEqual(
			creatorClient.oauth.cachedToken
		);

		creatorClient.oauth.cachedToken = undefined;
		expect(
			await PatreonOauthClient["validateToken"](creatorClient.oauth).catch(() => undefined)
		).toBeUndefined();

		expect(
			await PatreonOauthClient["validateToken"](creatorClient.oauth, "access_token")
		).toBeUndefined();
	});

	test("validate token concurrent refresh locking", async () => {
		creatorClient.oauth.options.validateToken = true;
		
		const expiredToken = {
			access_token: "old_access",
			refresh_token: "old_refresh",
			expires_in: "0",
			token_type: "Bearer",
			expires_in_epoch: "0"
		};
		creatorClient.oauth.cachedToken = expiredToken;

		let callCount = 0;
		const originalRefreshToken = creatorClient.oauth.refreshToken;
		
		creatorClient.oauth.refreshToken = async (t) => {
			callCount++;
			await new Promise(resolve => setTimeout(resolve, 50));
			return {
				access_token: "new_access",
				refresh_token: "new_refresh",
				expires_in: "10000",
				token_type: "Bearer",
				expires_in_epoch: (Date.now() + 10000000).toString()
			};
		};

		const [res1, res2] = await Promise.all([
			PatreonOauthClient["validateToken"](creatorClient.oauth, expiredToken),
			PatreonOauthClient["validateToken"](creatorClient.oauth, expiredToken)
		]);

		creatorClient.oauth.refreshToken = originalRefreshToken;

		expect(callCount).toBe(1);
		expect(res1).toBeDefined();
		expect(res1).toEqual(res2);
	});
});
