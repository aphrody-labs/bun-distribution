import { expect, test } from 'bun:test';
import { createOAuthHandler } from '../src/oauth.js';

const callbackUrl = 'https://bot.example/oauth/callback';
const baseOptions = {
	botToken: 'bot-token',
	clientId: 'client-id',
	clientSecret: 'client-secret',
	callbackUrl,
	guildId: '1554189180030947338',
};

function request(path: string, cookie?: string, method = 'GET', origin?: string): Request {
	return new Request(`https://bot.example${path}`, {
		method,
		headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
	});
}

function authorizedState(response: Response): string {
	return new URL(response.headers.get('location')!).searchParams.get('state')!;
}

test('user login requests only identify and bot installation uses a separate permission profile', async () => {
	const calls: string[] = [];
	const handler = createOAuthHandler({
		...baseOptions,
		fetchImpl: (async (input) => {
			calls.push(String(input));
			return Response.json({ redirect_uris: [callbackUrl] });
		}) as typeof fetch,
	});
	const login = (await handler(request('/oauth/login')))!;
	const loginUrl = new URL(login.headers.get('location')!);
	expect(login.status).toBe(302);
	expect(loginUrl.searchParams.get('scope')).toBe('identify');
	expect(loginUrl.searchParams.has('permissions')).toBe(false);
	expect(loginUrl.searchParams.has('guild_id')).toBe(false);
	expect(loginUrl.searchParams.get('response_type')).toBe('code');
	expect(login.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Lax');

	const install = (await handler(request('/oauth/install')))!;
	const installUrl = new URL(install.headers.get('location')!);
	expect(installUrl.searchParams.get('scope')).toBe('bot applications.commands');
	expect(installUrl.searchParams.get('permissions')).toBe('8');
	expect(installUrl.searchParams.has('response_type')).toBe(false);
	expect(calls).toHaveLength(1);

	const productionInstall = (await createOAuthHandler({ ...baseOptions, guildId: 'other-guild' })(
		request('/oauth/install'),
	))!;
	expect(new URL(productionInstall.headers.get('location')!).searchParams.get('permissions')).toBe('0');
});

test('login reports a missing registered callback without starting consent', async () => {
	const handler = createOAuthHandler({
		...baseOptions,
		fetchImpl: (async (_input) => Response.json({ redirect_uris: [] })) as typeof fetch,
	});
	const response = (await handler(request('/oauth/login')))!;
	expect(response.status).toBe(503);
	expect(response.headers.get('location')).toBeNull();
	expect(await response.text()).toContain(callbackUrl);
});

test('login limits Discord configuration requests and recovers after the window', async () => {
	let now = 1_000;
	let checks = 0;
	const handler = createOAuthHandler({
		...baseOptions,
		now: () => now,
		fetchImpl: (async (_input) => {
			checks++;
			return Response.json({ redirect_uris: [callbackUrl] });
		}) as typeof fetch,
	});
	for (let index = 0; index < 60; index++) expect((await handler(request('/oauth/login')))?.status).toBe(302);
	const limited = (await handler(request('/oauth/login')))!;
	expect(limited.status).toBe(429);
	expect(limited.headers.get('retry-after')).toBe('60');
	expect(checks).toBe(60);
	now += 60_000;
	expect((await handler(request('/oauth/login')))?.status).toBe(302);
	expect(checks).toBe(61);
});

test('callback consumes state, revokes its token, and creates a short local session', async () => {
	const calls: string[] = [];
	const handler = createOAuthHandler({
		...baseOptions,
		fetchImpl: (async (input, init) => {
			const url = String(input);
			calls.push(url);
			if (url.endsWith('/applications/@me')) return Response.json({ redirect_uris: [callbackUrl] });
			if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'access-token', token_type: 'Bearer' });
			if (url.endsWith('/users/@me')) {
				expect(new Headers(init?.headers).get('authorization')).toBe('Bearer access-token');
				return Response.json({ id: 'user-1', username: 'alice', global_name: '<Alice>' });
			}
			if (url.endsWith('/oauth2/token/revoke')) {
				expect(new URLSearchParams(String(init?.body)).get('token')).toBe('access-token');
				return new Response(null, { status: 200 });
			}
			throw new Error('unexpected Discord endpoint');
		}) as typeof fetch,
	});
	const login = (await handler(request('/oauth/login')))!;
	const state = authorizedState(login);
	const callbackPath = `/oauth/callback?state=${state}&code=one-time-code`;
	const callback = (await handler(request(callbackPath, `discord_oauth_state=${state}`)))!;
	expect(callback.status).toBe(200);
	expect(await callback.text()).toContain('&lt;Alice&gt;');
	expect(calls.filter((url) => url.endsWith('/oauth2/token/revoke'))).toHaveLength(1);
	const cookies = callback.headers.getSetCookie();
	expect(cookies).toHaveLength(2);
	expect(cookies[0]).toContain('discord_oauth_state=;');
	const sessionCookie = cookies[1]!.split(';')[0]!;
	expect(sessionCookie.startsWith('discord_session=')).toBe(true);
	const session = (await handler(request('/oauth/session', sessionCookie)))!;
	expect(await session.json()).toEqual({ id: 'user-1', name: '<Alice>' });
	expect((await handler(request(callbackPath, `discord_oauth_state=${state}`)))!.status).toBe(400);
	expect(calls.filter((url) => url.endsWith('/oauth2/token'))).toHaveLength(1);

	expect((await handler(request('/oauth/logout', sessionCookie, 'POST', 'https://evil.example')))?.status).toBe(403);
	expect((await handler(request('/oauth/logout', sessionCookie, 'POST', 'https://bot.example')))?.status).toBe(204);
	expect((await handler(request('/oauth/session', sessionCookie)))?.status).toBe(401);
});

test('expired or denied authorization never exchanges a code', async () => {
	let now = 1_000;
	let exchanges = 0;
	const handler = createOAuthHandler({
		...baseOptions,
		now: () => now,
		fetchImpl: (async (input) => {
			if (String(input).endsWith('/applications/@me')) return Response.json({ redirect_uris: [callbackUrl] });
			exchanges++;
			return new Response(null, { status: 500 });
		}) as typeof fetch,
	});
	const expiredState = authorizedState((await handler(request('/oauth/login')))!);
	now += 300_001;
	expect(
		(await handler(request(`/oauth/callback?state=${expiredState}&code=code`, `discord_oauth_state=${expiredState}`)))
			?.status,
	).toBe(400);
	const deniedState = authorizedState((await handler(request('/oauth/login')))!);
	expect(
		(
			await handler(
				request(`/oauth/callback?state=${deniedState}&error=access_denied`, `discord_oauth_state=${deniedState}`),
			)
		)?.status,
	).toBe(400);
	expect(
		(await handler(request(`/oauth/callback?state=${deniedState}&code=code`, `discord_oauth_state=${deniedState}`)))
			?.status,
	).toBe(400);
	expect(exchanges).toBe(0);
});

test('a wrong cookie cannot consume another login state', async () => {
	let exchanges = 0;
	const handler = createOAuthHandler({
		...baseOptions,
		fetchImpl: (async (input) => {
			if (String(input).endsWith('/applications/@me')) return Response.json({ redirect_uris: [callbackUrl] });
			exchanges++;
			return new Response(null, { status: 500 });
		}) as typeof fetch,
	});
	const state = authorizedState((await handler(request('/oauth/login')))!);
	const callbackPath = `/oauth/callback?state=${state}&code=code`;
	expect((await handler(request(callbackPath, 'discord_oauth_state=wrong')))?.status).toBe(400);
	expect((await handler(request(callbackPath, `discord_oauth_state=${state}`)))?.status).toBe(502);
	expect(exchanges).toBe(1);
});

test('failed token revocation does not create a session', async () => {
	const handler = createOAuthHandler({
		...baseOptions,
		fetchImpl: (async (input) => {
			const url = String(input);
			if (url.endsWith('/applications/@me')) return Response.json({ redirect_uris: [callbackUrl] });
			if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'access-token', token_type: 'Bearer' });
			if (url.endsWith('/users/@me')) return Response.json({ id: 'user-1', username: 'alice' });
			if (url.endsWith('/oauth2/token/revoke')) return new Response(null, { status: 500 });
			throw new Error('unexpected endpoint');
		}) as typeof fetch,
	});
	const state = authorizedState((await handler(request('/oauth/login')))!);
	const callback = (await handler(
		request(`/oauth/callback?state=${state}&code=code`, `discord_oauth_state=${state}`),
	))!;
	expect(callback.status).toBe(502);
	expect(callback.headers.get('set-cookie')).not.toContain('discord_session=');
});

test('a new login rotates the local session and sessions expire', async () => {
	let now = 1_000;
	const handler = createOAuthHandler({
		...baseOptions,
		now: () => now,
		fetchImpl: (async (input) => {
			const url = String(input);
			if (url.endsWith('/applications/@me')) return Response.json({ redirect_uris: [callbackUrl] });
			if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'access-token', token_type: 'Bearer' });
			if (url.endsWith('/users/@me')) return Response.json({ id: 'user-1', username: 'alice' });
			if (url.endsWith('/oauth2/token/revoke')) return new Response(null, { status: 200 });
			throw new Error('unexpected endpoint');
		}) as typeof fetch,
	});
	const firstState = authorizedState((await handler(request('/oauth/login')))!);
	const first = (await handler(
		request(`/oauth/callback?state=${firstState}&code=first`, `discord_oauth_state=${firstState}`),
	))!;
	const firstCookie = first.headers.getSetCookie()[1]!.split(';')[0]!;
	const secondState = authorizedState((await handler(request('/oauth/login')))!);
	const second = (await handler(
		request(`/oauth/callback?state=${secondState}&code=second`, `discord_oauth_state=${secondState}; ${firstCookie}`),
	))!;
	const secondCookie = second.headers.getSetCookie()[1]!.split(';')[0]!;
	expect(firstCookie).not.toBe(secondCookie);
	expect((await handler(request('/oauth/session', firstCookie)))?.status).toBe(401);
	expect((await handler(request('/oauth/session', secondCookie)))?.status).toBe(200);
	now += 3_600_001;
	expect((await handler(request('/oauth/session', secondCookie)))?.status).toBe(401);
});
