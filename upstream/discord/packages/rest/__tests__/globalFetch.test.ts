import { afterEach, expect, test, vi } from 'vitest';
import { globalFetch } from '../src/strategies/globalFetch.js';

afterEach(() => vi.unstubAllGlobals());

test('adapts the global fetch response to the REST transport', async () => {
	const fetchMock = vi.fn(async () => new Response('ok', { status: 201, headers: { 'x-test': 'yes' } }));
	vi.stubGlobal('fetch', fetchMock);

	const response = await globalFetch('https://example.test', { method: 'POST' });
	expect(fetchMock).toHaveBeenCalledWith('https://example.test', { method: 'POST' });
	expect(response.status).toBe(201);
	expect(response.headers.get('x-test')).toBe('yes');
	expect(response.bodyUsed).toBe(false);
	expect(await response.clone?.().text()).toBe('ok');
	expect(await response.text()).toBe('ok');
	expect(response.bodyUsed).toBe(true);
});
