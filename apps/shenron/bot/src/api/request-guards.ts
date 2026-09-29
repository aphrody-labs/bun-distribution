import { a2aDeniedBody, a2aEnforced, A2A_TOKEN_ENV, decideA2AWrite } from "@shenron/auth/a2a";
import {
	clientIpFromHeaders,
	isDirectLoopback as isDirectLoopbackHeaders,
} from "@shenron/config/net";

/**
 * Gardes de requête de l'API du bot (S3, S4, S5 — docs/STACK.md §2.2).
 * Fonctions pures : aucune lecture d'environnement ni état global au chargement.
 */

;

/**
 * IP du client telle que nginx la voit (S3), doctrine de `@shenron/config/net` :
 * - `x-real-ip` (posé par nginx au `$remote_addr`, non usurpable) ;
 * - sinon le DERNIER saut de `X-Forwarded-For` (ajouté par le proxy de tête) —
 *   jamais le premier, écrit par le client ;
 * - sinon `unknown` (un seau commun vaut mieux qu'aucune limite).
 */
export function clientIp(req: Request): string {
	return clientIpFromHeaders(req.headers);
}

/**
 * Appel loopback direct (S3) : socket loopback ET ni `x-real-ip` ni
 * `X-Forwarded-For`. Une requête relayée par nginx (même depuis la boucle
 * locale) porte `x-real-ip` et reste donc limitée.
 */
export function isDirectLoopback(req: Request, remoteAddress: string | null | undefined): boolean {
	return isDirectLoopbackHeaders(req.headers, remoteAddress);
}

interface ThrottleDecision {
	allowed: boolean;
	/** Délai conseillé (en-tête `Retry-After`), en secondes. */
	retryAfterSeconds: number;
}

export interface LoginThrottle {
	/** Compte une tentative pour `key` et dit si elle est admise. */
	hit(key: string): ThrottleDecision;
	/** Nombre de clés suivies (observabilité / tests). */
	size(): number;
}

export interface LoginThrottleOptions {
	/** Tentatives admises par fenêtre (défaut 10). */
	limit?: number;
	/** Durée de la fenêtre en ms (défaut 60 000). */
	windowMs?: number;
	/** Horloge injectable (défaut `Date.now`). */
	now?: () => number;
	/** Au-delà de ce nombre de clés, les fenêtres expirées sont purgées (défaut 10 000). */
	maxKeys?: number;
}

/**
 * Limiteur à fenêtre fixe par clé (S4 : 10 tentatives/min/IP sur `/auth/login`).
 * Chaque tentative compte, avant toute comparaison de jeton ; la 11ᵉ d'une
 * fenêtre est refusée avec `Retry-After: 60`.
 */
export function createLoginThrottle(options: LoginThrottleOptions = {}): LoginThrottle {
	const limit = options.limit ?? 10;
	const windowMs = options.windowMs ?? 60_000;
	const now = options.now ?? Date.now;
	const maxKeys = options.maxKeys ?? 10_000;
	const retryAfterSeconds = Math.max(1, Math.ceil(windowMs / 1000));
	const buckets = new Map<string, { count: number; resetAt: number }>();

	function sweep(at: number): void {
		for (const [key, bucket] of buckets) {
			if (bucket.resetAt <= at) buckets.delete(key);
		}
	}

	return {
		hit(key) {
			const at = now();
			let bucket = buckets.get(key);
			if (!bucket || bucket.resetAt <= at) {
				if (!bucket && buckets.size >= maxKeys) sweep(at);
				bucket = { count: 0, resetAt: at + windowMs };
				buckets.set(key, bucket);
			}
			bucket.count += 1;
			return { allowed: bucket.count <= limit, retryAfterSeconds };
		},
		size: () => buckets.size,
	};
}

/** Méthodes JSON-RPC A2A du bot qui écrivent dans `.coord` (D14). */
export const A2A_WRITE_METHODS: ReadonlySet<string> = new Set(["message/send", "tasks/cancel"]);

/**
 * Garde d'écriture A2A du bot (S5). `null` = la requête continue telle
 * qu'aujourd'hui ; sinon la réponse de refus (`503 a2a_not_configured` ou
 * `401 a2a_unauthorized`). Drapeau inactif : jamais de refus, un avertissement
 * unique par processus.
 */
export function a2aWriteGuard(
	req: Request,
	env: Readonly<Record<string, string | undefined>>,
	warn?: (message: string) => void
): Response | null {
	const decision = decideA2AWrite(req.headers, {
		token: env[A2A_TOKEN_ENV],
		enforce: a2aEnforced(env),
		warn,
	});
	if (decision.ok) return null;
	return Response.json(a2aDeniedBody(decision), {
		status: decision.status,
		headers: decision.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined,
	});
}
