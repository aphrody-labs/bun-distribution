// SPDX-License-Identifier: Apache-2.0
/**
 * Platform detection for apps/web: a Tauri webview (invoke through
 * __TAURI_INTERNALS__) or a browser (POST /api/bridge/<cmd> on the Bun server).
 * The React Native branch only detects; no React Native project uses this code.
 */

export type PlatformTarget = 'web' | 'tauri' | 'native';

export function detectPlatform(): PlatformTarget {
  if (typeof window !== 'undefined') {
    if ('__TAURI_INTERNALS__' in window || '__TAURI__' in window) {
      return 'tauri';
    }
    return 'web';
  }
  if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
    return 'native';
  }
  return 'web';
}

export interface NativeBridge {
  target: PlatformTarget;
  isTauri: boolean;
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

export function createBridge(): NativeBridge {
  const target = detectPlatform();
  const isTauri = target === 'tauri';

  return {
    target,
    isTauri,
    async invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
      if (isTauri && typeof window !== 'undefined') {
        const tauri = (window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__;
        if (tauri?.invoke) {
          return tauri.invoke(cmd, args);
        }
      }
      // Fallback for Web: route through native Bun HTTP API
      const res = await fetch(`/api/bridge/${cmd}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args ?? {}),
      });
      if (!res.ok) {
        throw new Error(`Bridge call ${cmd} failed: ${res.statusText}`);
      }
      return res.json();
    },
  };
}
