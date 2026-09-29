// SPDX-License-Identifier: MIT
import { parseWebhookRequest, WebhookPayloadClient } from "@rosegriffon/patreon-bun";

type Embed = Record<string, string | number | boolean>;

const converter = WebhookPayloadClient.convert<Embed>({
	default: {
		title: "Updated post: {{title}}",
		color: 0x5865f2,
	},
});

Bun.serve({
	port: 8080,
	async fetch(request) {
		if (new URL(request.url).pathname !== "/webhook") {
			return new Response("Not found", { status: 404 });
		}
		if (request.method !== "POST") {
			return new Response("Method not allowed", { status: 405 });
		}

		const result = await parseWebhookRequest(request, Bun.env.PATREON_WEBHOOK_SECRET!);
		if (!result.verified) {
			return new Response("Invalid signature", { status: 403 });
		}

		const embed = converter(result.event, result.payload);
		if (embed) {
			const response = await fetch(Bun.env.DISCORD_WEBHOOK_URL!, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ embeds: [embed] }),
			});
			if (!response.ok) return new Response("Discord webhook failed", { status: 502 });
		}

		return new Response("OK");
	},
});
