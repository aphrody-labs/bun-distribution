// SPDX-License-Identifier: Apache-2.0
/**
 * Tauri v2 IPC Bridge for Next.js Server Actions and API Routes
 */

export interface TauriInvokeOptions {
  headers?: Record<string, string>;
}

export async function tauriInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (typeof window !== "undefined") {
    const tauri = (window as any).__TAURI__?.core || (window as any).__TAURI_INTERNALS__;
    if (tauri?.invoke) {
      return await tauri.invoke(cmd, args);
    }
  }
  throw new Error(`Tauri invoke not available for command "${cmd}". Ensure Tauri runtime is initialized.`);
}

/**
 * Creates a client-side wrapper for a Next.js Server Action that delegates
 * to a Tauri native command when in desktop mode, or to a fallback / fetch endpoint in Vite.
 */
export function createServerActionBridge<TArgs = any, TResult = any>(
  actionName: string,
  options?: {
    tauriCommand?: string;
    endpoint?: string;
    localFallback?: (args: TArgs) => Promise<TResult>;
  },
): (args: TArgs) => Promise<TResult> {
  const tauriCmd = options?.tauriCommand || `action_${actionName.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  const endpoint = options?.endpoint || `/api/actions/${actionName}`;

  return async (args: TArgs): Promise<TResult> => {
    // 1. Try Tauri native invoke
    if (typeof window !== "undefined" && ((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__)) {
      try {
        return await tauriInvoke<TResult>(tauriCmd, { payload: args });
      } catch (err: any) {
        if (!options?.localFallback && !options?.endpoint) {
          throw err;
        }
      }
    }

    // 2. Try HTTP fetch if endpoint provided
    if (options?.endpoint && typeof fetch !== "undefined") {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) {
        throw new Error(`Action ${actionName} failed with HTTP ${res.status}`);
      }
      return await res.json();
    }

    // 3. Try local fallback if available
    if (options?.localFallback) {
      return await options.localFallback(args);
    }

    throw new Error(
      `Unable to execute Server Action "${actionName}". Neither Tauri IPC nor HTTP endpoint is available.`,
    );
  };
}
