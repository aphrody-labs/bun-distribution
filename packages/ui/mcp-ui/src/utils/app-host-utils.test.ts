import { describe, it, expect } from 'bun:test';

import { SANDBOX_PROXY_READY_METHOD } from '@modelcontextprotocol/ext-apps/app-bridge';

import { setupSandboxProxyIframe, type SandboxCancelRef } from './app-host-utils';

describe('setupSandboxProxyIframe', () => {
  it('rejects onReady when sandbox never becomes ready (timeout)', async () => {
    const cancelRef: SandboxCancelRef = {};
    const { onReady } = await setupSandboxProxyIframe(
      new URL('https://example.com/proxy'),
      cancelRef,
      20,
    );

    await expect(onReady).rejects.toThrow(
      /Timed out waiting for sandbox proxy iframe to be ready/,
    );
  });

  it('resolves onReady when cancel is called before the sandbox handshake completes', async () => {
    const cancelRef: SandboxCancelRef = {};
    const { onReady } = await setupSandboxProxyIframe(
      new URL('https://example.com/proxy'),
      cancelRef,
      2000,
    );

    expect(typeof cancelRef.cancel).toBe('function');
    cancelRef.cancel!();

    await expect(onReady).resolves.toBeUndefined();
  });

  it('resolves onReady when the sandbox posts the ready message', async () => {
    const { iframe, onReady } = await setupSandboxProxyIframe(
      new URL('https://example.com/proxy'),
      undefined,
      2000,
    );

    // jsdom does not attach contentWindow to programmatic iframes; the handler matches
    // event.source === iframe.contentWindow, so expose a stable mock window reference.
    const sandboxWindow = {} as Window;
    Object.defineProperty(iframe, 'contentWindow', {
      get: () => sandboxWindow,
      configurable: true,
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        source: sandboxWindow,
        data: { method: SANDBOX_PROXY_READY_METHOD },
      }),
    );

    await expect(onReady).resolves.toBeUndefined();
  });
});
