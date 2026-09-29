import { resolveRedisUrl } from "@shenron/config/services";
type RateLimitOptions = {
	windowMs: number;
	limit: number;
	namespace?: string;
	backend?: () => Promise<RedisClient>;
};
export type RateLimitDecision = {
	limited: boolean;
	retryAfter: number;
	remaining: number;
	backend: "redis" | "unavailable";
};
interface RedisClient {
	onclose: ((error: Error) => void) | null;
	send(command: string, args: string[]): Promise<unknown>;
}
interface ConnectingRedisClient extends RedisClient {
	connect(): Promise<void>;
}
let client: RedisClient | null = null;
let loading: Promise<RedisClient> | null = null;

async function redis(): Promise<RedisClient> {
	if (client) return client;
	if (loading) return loading;
	loading = (async () => {
		const { RedisClient } = (await import("bun")) as unknown as {
			RedisClient: new (url: string, options: Record<string, unknown>) => ConnectingRedisClient;
		};
		const value = new RedisClient(resolveRedisUrl(process.env), {
			autoReconnect: true,
			maxRetries: 2,
			enableOfflineQueue: false,
		});
		value.onclose = () => {
			if (client === value) client = null;
		};
		// Bun ouvre la connexion au premier envoi. Avec l'offline queue désactivée,
		// ce premier EVAL peut être refusé pendant le handshake et le site répond
		// alors 429 bien que Redis soit disponible. Attendre explicitement le
		// handshake conserve le refus fermé lors d'une vraie panne, sans faux refus.
		await value.connect();
		client = value;
		return value;
	})().finally(() => {
		loading = null;
	});
	return loading;
}

const ATOMIC_WINDOW = `local count = redis.call('INCRBY', KEYS[1], ARGV[1])
if count == tonumber(ARGV[1]) then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
local ttl = redis.call('PTTL', KEYS[1])
return { count, ttl }`;

/** Compteur Redis atomique, partagé entre slots Next et instances du site. */
export function createMemoryRateLimiter({
	windowMs,
	limit,
	namespace = "write",
	backend = redis,
}: RateLimitOptions) {
	if (windowMs <= 0 || limit <= 0) throw new RangeError("Configuration de rate-limit invalide");
	return {
		async consume(key: string, cost = 1): Promise<RateLimitDecision> {
			try {
				const result = (await (
					await backend()
				).send("EVAL", [
					ATOMIC_WINDOW,
					"1",
					`shenron:rate-limit:${namespace}:${key}`,
					String(Math.max(1, Math.floor(cost))),
					String(windowMs),
				])) as [number | string, number | string];
				const count = Number(result[0]);
				return {
					limited: count > limit,
					retryAfter: Math.max(1, Math.ceil(Math.max(1, Number(result[1])) / 1000)),
					remaining: Math.max(0, limit - count),
					backend: "redis",
				};
			} catch (error) {
				client = null;
				console.error("[rate-limit] Redis indisponible, écriture refusée", error);
				return {
					limited: true,
					retryAfter: Math.ceil(windowMs / 1000),
					remaining: 0,
					backend: "unavailable",
				};
			}
		},
	};
}

const rateLimitHeaders = (decision: RateLimitDecision): Record<string, string> => ({
	"Retry-After": String(decision.retryAfter),
	"X-RateLimit-Remaining": String(decision.remaining),
});
