/**
 * Multi-target platform detection and abstraction.
 * Unifies execution across:
 *  1. Bun Web Browser (Native DOM + Web APIs)
 *  2. Tauri Desktop (Rust IPC via lowest-level invoke)
 *  3. React Native / Mobile
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
  sendWsMessage(message: unknown): void;
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
    sendWsMessage(message: unknown) {
      if (typeof window !== 'undefined' && (window as any).__aphrodyWs?.readyState === WebSocket.OPEN) {
        (window as any).__aphrodyWs.send(JSON.stringify(message));
      }
    }
  };
}
