import { Client, Command } from '@buape/carbon';
import { createHandler } from '@buape/carbon/adapters/fetch';
import { GatewayPlugin } from '@buape/carbon/gateway';
import { createOAuthHandler } from './oauth.js';

const token = Bun.env.DISCORD_BOT_TOKEN;
const baseUrl = Bun.env.BASE_URL;
const clientId = Bun.env.DISCORD_CLIENT_ID;
const publicKey = Bun.env.DISCORD_PUBLIC_KEY;
const clientSecret = Bun.env.DISCORD_CLIENT_SECRET;
const guildId = Bun.env.DISCORD_GUILD_ID;

if (!token || !baseUrl || !clientId || !publicKey || !clientSecret || !guildId) {
	throw new Error('Set Discord bot credentials, BASE_URL, and DISCORD_CLIENT_SECRET before starting this example.');
}

class PingCommand extends Command {
	name = 'ping';
	description = 'Replies with Pong.';

	async run(interaction: Parameters<Command['run']>[0]) {
		await interaction.reply('Pong!');
	}
}

const client = new Client(
	{
		baseUrl,
		token,
		clientId,
		publicKey,
		autoDeploy: true,
		devGuilds: [guildId],
		disableDeployRoute: true,
	},
	{ commands: [new PingCommand()] },
	[new GatewayPlugin({ intents: 1, autoInteractions: false })],
);

const port = Number(Bun.env.PORT ?? 3000);
const interactions = createHandler(client);
const callbackUrl = new URL('/oauth/callback', baseUrl).toString();
const oauth = createOAuthHandler({ botToken: token, clientId, clientSecret, callbackUrl, guildId });

Bun.serve({
	port,
	hostname: '127.0.0.1',
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === '/healthz') {
			const gatewayConnected = client.getPlugin<GatewayPlugin>('gateway')?.isConnected ?? false;
			return Response.json(
				{ status: gatewayConnected ? 'ok' : 'degraded', gatewayConnected },
				{ status: gatewayConnected ? 200 : 503 },
			);
		}
		const oauthResponse = await oauth(request);
		if (oauthResponse) return oauthResponse;
		return interactions(request, {});
	},
});

console.info(`Discord test service listening on 127.0.0.1:${port}`);
