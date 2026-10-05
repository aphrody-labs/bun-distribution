/**
 * Tauri 2.0 IPC Layer wrapper.
 * Provides safe detection and invocation of Rust commands via Tauri 2.0 IPC.
 */

declare global {
	interface Window {
		__TAURI_INTERNALS__?: {
			invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
		};
		__TAURI__?: {
			core?: {
				invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
			};
			event?: {
				listen: <T = unknown>(
					event: string,
					handler: (event: { payload: T }) => void
				) => Promise<() => void>;
				emit: (event: string, payload?: unknown) => Promise<void>;
			};
		};
	}
}

/**
 * Checks if the current environment is running inside a Tauri container.
 */
export function isTauri(): boolean {
	if (typeof window === "undefined") return false;
	return Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

/**
 * Invokes a Tauri command safely.
 * Throws an error if not in a Tauri environment.
 */
export async function tauriInvoke<T>(
	command: string,
	args?: Record<string, unknown>
): Promise<T> {
	if (typeof window === "undefined") {
		throw new Error(`[PIPELINE-IPC] Cannot invoke Tauri command '${command}' in non-browser environment.`);
	}

	if (window.__TAURI_INTERNALS__?.invoke) {
		return window.__TAURI_INTERNALS__.invoke<T>(command, args);
	}

	if (window.__TAURI__?.core?.invoke) {
		return window.__TAURI__.core.invoke<T>(command, args);
	}

	// Try dynamic import of @aphrody/api/core if available in bundle
	try {
		const moduleName = "@aphrody/api/core";
		const tauriCore = await import(/* @vite-ignore */ moduleName);
		if (typeof tauriCore.invoke === "function") {
			return await tauriCore.invoke(command, args);
		}
	} catch {
		// Not bundled or not running in Tauri
	}

	throw new Error(
		`[PIPELINE-IPC] Tauri 2.0 environment not detected. Command '${command}' requires Aphrody Rust Backend or fallback HTTP transport.`
	);
}

/**
 * Listens to a Tauri event.
 */
export async function tauriListen<T>(
	event: string,
	callback: (payload: T) => void
): Promise<() => void> {
	if (typeof window === "undefined") return () => {};

	if (window.__TAURI__?.event?.listen) {
		return window.__TAURI__.event.listen<T>(event, (e) => callback(e.payload));
	}

	try {
		const moduleName = "@aphrody/api/event";
		const tauriEvent = await import(/* @vite-ignore */ moduleName);
		if (typeof tauriEvent.listen === "function") {
			return await tauriEvent.listen(event, (e: { payload: T }) => callback(e.payload));
		}
	} catch {
		// Not bundled
	}

	console.warn(`[PIPELINE-IPC] Listening to event '${event}' skipped: Tauri IPC not available.`);
	return () => {};
}
