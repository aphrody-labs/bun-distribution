/**
 * Client API — toujours same-origin (le dashboard est servi par shenron).
 *
 * Auth : cookie de session signé set par /auth/login. Le serveur Next-équivalent
 * (= server.ts/auth.ts dans shenron) injecte le Bearer côté serveur quand il
 * forward vers les routes admin de l'API. Le navigateur ne voit jamais le token.
 */

// API routes préfixées /api ; auth routes sur /auth (sans préfixe)
const API_BASE = "/api";
const AUTH_PATHS = new Set(["/auth/me", "/auth/login", "/auth/logout"]);
function resolvePath(path: string): string {
	if (AUTH_PATHS.has(path) || path.startsWith("/auth/")) return path;
	return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

interface ApiOpts extends RequestInit {
	json?: unknown;
}

class ApiError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

async function request<T>(path: string, opts: ApiOpts = {}): Promise<T> {
	const headers = new Headers(opts.headers);
	let body: BodyInit | undefined = opts.body as BodyInit | undefined;
	if (opts.json !== undefined) {
		headers.set("Content-Type", "application/json");
		body = JSON.stringify(opts.json);
	}
	const res = await fetch(resolvePath(path), {
		credentials: "same-origin",
		...opts,
		headers,
		body,
	});
	if (res.status === 401) {
		// Session expirée — redirige login. On exclut /discord/* (peut 401 légitimement
		// quand l'user est loggué via token admin sans OAuth Discord ; le caller gère)
		// et /auth/me (utilisé pour probe la session ; doit pouvoir renvoyer 401 sans loop).
		const isOptional = path.startsWith("/discord/") || path === "/auth/me";
		if (!isOptional && typeof window !== "undefined") window.location.href = "/login";
		throw new ApiError(401, "Session expirée");
	}
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new ApiError(res.status, text || `HTTP ${res.status}`);
	}
	return (await res.json()) as T;
}

export const api = {
	get: <T = unknown>(path: string) => request<T>(path),
	post: <T = unknown>(path: string, json?: unknown) => request<T>(path, { method: "POST", json }),
	put: <T = unknown>(path: string, json?: unknown) => request<T>(path, { method: "PUT", json }),
	delete: <T = unknown>(path: string) => request<T>(path, { method: "DELETE" }),
};

export { ApiError };
