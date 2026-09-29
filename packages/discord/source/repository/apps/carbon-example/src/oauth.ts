export interface OAuthOptions {
	botToken: string;
	clientId: string;
	clientSecret: string;
	callbackUrl: string;
	guildId: string;
	fetchImpl?: typeof fetch;
	now?: () => number;
}

const DEVELOPMENT_GUILD_ID = '1554189180030947338';
const STATE_LIFETIME_MS = 5 * 60_000;
const SESSION_LIFETIME_MS = 60 * 60_000;
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_LIMIT = 60;
const stateCookie = 'discord_oauth_state';
const sessionCookie = 'discord_session';
const cookieFlags = 'HttpOnly; Secure; SameSite=Lax';

function cookie(request: Request, name: string): string | undefined {
	return request.headers
		.get('cookie')
		?.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${name}=`))
		?.slice(name.length + 1);
}

function clearCookie(name: string, path: string): string {
	return `${name}=; Path=${path}; ${cookieFlags}; Max-Age=0`;
}

function escapeHtml(value: string): string {
	return value.replace(
		/[&<>"']/g,
		(char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
	);
}

function noStoreResponse(body: BodyInit | null, status: number, headers: HeadersInit = {}): Response {
	const responseHeaders = new Headers(headers);
	responseHeaders.set('Cache-Control', 'no-store');
	return new Response(body, { status, headers: responseHeaders });
}

export function createOAuthHandler(options: OAuthOptions): (request: Request) => Promise<Response | null> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const now = options.now ?? Date.now;
	const states = new Map<string, number>();
	const sessions = new Map<string, { id: string; name: string; expiresAt: number }>();
	let loginWindowStart = now();
	let loginAttempts = 0;
	const callbackUrl = new URL(options.callbackUrl).toString();
	const origin = new URL(callbackUrl).origin;

	return async (request) => {
		const url = new URL(request.url);
		if (!url.pathname.startsWith('/oauth/')) return null;
		if (url.pathname === '/oauth/logout') {
			if (request.method !== 'POST') return noStoreResponse('Method not allowed', 405);
			if (request.headers.get('origin') !== origin) return noStoreResponse('Invalid origin', 403);
			const id = cookie(request, sessionCookie);
			if (id) sessions.delete(id);
			return noStoreResponse(null, 204, { 'Set-Cookie': clearCookie(sessionCookie, '/oauth') });
		}
		if (request.method !== 'GET') return noStoreResponse('Method not allowed', 405);
		if (url.pathname === '/oauth/install') {
			const authorize = new URL('https://discord.com/oauth2/authorize');
			authorize.search = new URLSearchParams({
				client_id: options.clientId,
				scope: 'bot applications.commands',
				permissions: options.guildId === DEVELOPMENT_GUILD_ID ? '8' : '0',
				guild_id: options.guildId,
				disable_guild_select: 'true',
				integration_type: '0',
			}).toString();
			return noStoreResponse(null, 302, { Location: authorize.toString() });
		}
		if (url.pathname === '/oauth/session') {
			const id = cookie(request, sessionCookie);
			const session = id ? sessions.get(id) : undefined;
			if (!session || now() >= session.expiresAt) {
				if (id) sessions.delete(id);
				return noStoreResponse('Unauthorized', 401, { 'Set-Cookie': clearCookie(sessionCookie, '/oauth') });
			}
			return Response.json({ id: session.id, name: session.name }, { headers: { 'Cache-Control': 'no-store' } });
		}
		if (url.pathname === '/oauth/login') {
			const loginTime = now();
			if (loginTime >= loginWindowStart + LOGIN_WINDOW_MS || loginTime < loginWindowStart) {
				loginWindowStart = loginTime;
				loginAttempts = 0;
			}
			if (loginAttempts >= LOGIN_LIMIT) {
				const retryAfter = Math.ceil((loginWindowStart + LOGIN_WINDOW_MS - loginTime) / 1_000);
				return noStoreResponse('OAuth login rate limited', 429, { 'Retry-After': String(retryAfter) });
			}
			loginAttempts++;
			let applicationResponse: Response;
			try {
				applicationResponse = await fetchImpl('https://discord.com/api/v10/applications/@me', {
					headers: { Authorization: `Bot ${options.botToken}` },
				});
			} catch {
				return noStoreResponse('Unable to verify Discord OAuth configuration', 502);
			}
			if (!applicationResponse.ok) return noStoreResponse('Unable to verify Discord OAuth configuration', 502);
			const application = (await applicationResponse.json().catch(() => null)) as { redirect_uris?: string[] } | null;
			if (!application?.redirect_uris?.includes(callbackUrl)) {
				const portalUrl = `https://discord.com/developers/applications/${options.clientId}/oauth2/general`;
				return noStoreResponse(
					`<h1>Discord OAuth setup required</h1><p>Add this exact redirect URI in the <a href="${portalUrl}">Developer Portal</a>:</p><code>${escapeHtml(callbackUrl)}</code>`,
					503,
					{ 'Content-Type': 'text/html; charset=utf-8' },
				);
			}
			for (const [state, expiresAt] of states) if (now() >= expiresAt) states.delete(state);
			if (states.size >= 10_000) return noStoreResponse('OAuth login temporarily unavailable', 503);
			const state = crypto.randomUUID();
			states.set(state, now() + STATE_LIFETIME_MS);
			const authorize = new URL('https://discord.com/oauth2/authorize');
			authorize.search = new URLSearchParams({
				client_id: options.clientId,
				redirect_uri: callbackUrl,
				response_type: 'code',
				scope: 'identify',
				state,
			}).toString();
			return noStoreResponse(null, 302, {
				Location: authorize.toString(),
				'Set-Cookie': `${stateCookie}=${state}; Path=/oauth/callback; ${cookieFlags}; Max-Age=300`,
			});
		}
		if (url.pathname !== '/oauth/callback') return null;
		const clearState = { 'Set-Cookie': clearCookie(stateCookie, '/oauth/callback') };
		const state = url.searchParams.get('state');
		const savedState = cookie(request, stateCookie);
		const expiresAt = state ? states.get(state) : undefined;
		if (!state || !savedState || state !== savedState || !expiresAt || now() >= expiresAt) {
			if (state && state === savedState && expiresAt && now() >= expiresAt) states.delete(state);
			return noStoreResponse('OAuth state validation failed', 400, clearState);
		}
		states.delete(state);
		if (url.searchParams.has('error')) return noStoreResponse('OAuth authorization declined', 400, clearState);
		const code = url.searchParams.get('code');
		if (!code) return noStoreResponse('OAuth code missing', 400, clearState);
		let tokenResponse: Response;
		try {
			tokenResponse = await fetchImpl('https://discord.com/api/oauth2/token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					client_id: options.clientId,
					client_secret: options.clientSecret,
					grant_type: 'authorization_code',
					code,
					redirect_uri: callbackUrl,
				}),
			});
		} catch {
			return noStoreResponse('Discord OAuth exchange failed', 502, clearState);
		}
		if (!tokenResponse.ok) return noStoreResponse('Discord OAuth exchange failed', 502, clearState);
		const token = (await tokenResponse.json().catch(() => null)) as {
			access_token?: string;
			token_type?: string;
		} | null;
		if (!token?.access_token || token.token_type?.toLowerCase() !== 'bearer') {
			return noStoreResponse('Discord OAuth token invalid', 502, clearState);
		}
		const profileResponse = await fetchImpl('https://discord.com/api/users/@me', {
			headers: { Authorization: `Bearer ${token.access_token}` },
		}).catch(() => null);
		const revokeResponse = await fetchImpl('https://discord.com/api/oauth2/token/revoke', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: options.clientId,
				client_secret: options.clientSecret,
				token: token.access_token,
				token_type_hint: 'access_token',
			}),
		}).catch(() => null);
		if (!revokeResponse?.ok) return noStoreResponse('Discord OAuth revocation failed', 502, clearState);
		if (!profileResponse?.ok) return noStoreResponse('Discord profile lookup failed', 502, clearState);
		const profile = (await profileResponse.json().catch(() => null)) as {
			id?: string;
			username?: string;
			global_name?: string | null;
		} | null;
		if (!profile?.id || !profile.username) return noStoreResponse('Discord profile invalid', 502, clearState);
		const name = profile.global_name ?? profile.username;
		for (const [id, session] of sessions) if (now() >= session.expiresAt) sessions.delete(id);
		const previousSessionId = cookie(request, sessionCookie);
		if (previousSessionId) sessions.delete(previousSessionId);
		if (sessions.size >= 10_000) return noStoreResponse('OAuth session temporarily unavailable', 503, clearState);
		const sessionId = crypto.randomUUID();
		sessions.set(sessionId, { id: profile.id, name, expiresAt: now() + SESSION_LIFETIME_MS });
		const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
		headers.append('Set-Cookie', clearCookie(stateCookie, '/oauth/callback'));
		headers.append('Set-Cookie', `${sessionCookie}=${sessionId}; Path=/oauth; ${cookieFlags}; Max-Age=3600`);
		return noStoreResponse(`<h1>Discord OAuth OK</h1><p>Connecté : ${escapeHtml(name)}</p>`, 200, headers);
	};
}
