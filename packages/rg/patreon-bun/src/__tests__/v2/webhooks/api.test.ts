import { describe, expect, test } from "bun:test";

import { WebhookClient, QueryBuilder, type Webhook, PatreonCreatorClient } from "../../../v2";

import { clientId, clientSecret } from "../../client";
import { testWebhook } from "../../server/cache";

const creatorClient = new PatreonCreatorClient({
	oauth: {
		clientId,
		clientSecret,
		token: {
			access_token: "access_token",
			refresh_token: "refresh_token",
		},
	},
});

describe("webhook client", () => {
	test("webhook headers", () => {
		const headers = new Headers({
			[WebhookClient.headers.event]: "event",
			[WebhookClient.headers.signature]: "signature",
		});

		expect(WebhookClient.getWebhookHeaders(headers)).toHaveProperty("event", "event");
		expect(WebhookClient.getWebhookHeaders(headers)).toHaveProperty("signature", "signature");
	});

	test("webhook paused", () => {
		const webhook: Webhook = {
			num_consecutive_times_failed: 0,
			paused: false,
			triggers: [],
			uri: "https://ghostrider-05.com",
			secret: "htoihweowjewokpkpw.whfowhrowj",
			last_attempted_at: new Date().toISOString(),
		};

		const webhookClient = new WebhookClient(creatorClient.oauth);

		expect(webhookClient.hasUnsentEvents(webhook)).toBeFalsy();
	});

	describe("webhook API", () => {
		const id = "1234";
		const baseWebhook = {
			data: {
				type: "webhook",
				id,
				attributes: testWebhook.item,
			},
		};

		const pausedWebhook = {
			data: {
				type: "webhook",
				id,
				attributes: { ...testWebhook.item, paused: true },
			},
		};

		const client = creatorClient.webhooks;

		test("fetch webhooks", async () => {
			const query = QueryBuilder.webhooks;
			const webhooks = await client.fetchWebhooks(query);

			expect(webhooks.data[0].type).toEqual("webhook");
			console.log(webhooks);
		});

		// TODO: remove fails
		test.todo("edit webhooks", async () => {
			const res = await client.editWebhook({ id, paused: true });

			expect(res).toEqual(pausedWebhook);
		});

		test.todo("unpause webhooks", async () => {
			const res = await client.unpauseWebhook(id, { token: "token" });

			expect(res).toEqual(baseWebhook);
		});

		test.todo("pause webhooks", async () => {
			const res = await client.pauseWebhook(id, { token: "token" });

			expect(res).toEqual(pausedWebhook);
		});

		test.todo("create webhooks", async () => {
			const res = await client.createWebhook({
				campaignId: "campaign",
				triggers: ["posts:publish"],
				uri: "https://patreon-api.pages.dev",
			});

			expect(res).toEqual(baseWebhook);
		});

		test("delete a webhook", async () => {
			const deleteWebhook = () => client.deleteWebhook(id);
			await expect(deleteWebhook()).resolves.toBeUndefined();
		});
	});
});
