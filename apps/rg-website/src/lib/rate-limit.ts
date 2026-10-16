import type { NextRequest } from "next/server";
import { createPostgresClient } from "@rosegriffon/db/service";

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

/**
 * Vérifie si une requête dépasse la limite (via Supabase Postgres)
 */
export async function checkRateLimit(
  request: NextRequest,
  options: RateLimitOptions = { limit: 10, windowMs: 60_000 },
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const key = `${ip}:${request.nextUrl.pathname}`;
  const now = Date.now();

  const db = createPostgresClient();

  // Récupérer l'entrée
  const { data: entry, error } = await db.from("rate_limits").select("*").eq("key", key).maybeSingle();

  if (error) {
    console.error("Rate limit error:", error);
    return {
      allowed: true,
      remaining: options.limit,
      resetTime: now + options.windowMs,
    };
  }

  const lastRequestTime = entry ? new Date(entry.last_request).getTime() : 0;
  const resetTime = lastRequestTime + options.windowMs;

  if (!entry || resetTime < now) {
    // Nouvelle entrée ou expirée
    await db.from("rate_limits").upsert({
      count: 1,
      key,
      last_request: new Date().toISOString(),
    });
    return {
      allowed: true,
      remaining: options.limit - 1,
      resetTime: now + options.windowMs,
    };
  }

  const currentCount = entry.count ?? 0;

  // Incrémenter
  if (currentCount >= options.limit) {
    return { allowed: false, remaining: 0, resetTime };
  }

  await db
    .from("rate_limits")
    .update({ count: currentCount + 1 })
    .eq("key", key);

  return {
    allowed: true,
    remaining: options.limit - (currentCount + 1),
    resetTime,
  };
}

export function withRateLimit(handler: (request: NextRequest) => Promise<Response>, options?: RateLimitOptions) {
  return async (request: NextRequest): Promise<Response> => {
    const { allowed, remaining, resetTime } = await checkRateLimit(request, options);

    if (!allowed) {
      return new Response(
        JSON.stringify({
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Trop de requêtes. Veuillez réessayer plus tard.",
          },
          success: false,
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Retry-After": Math.ceil((resetTime - Date.now()) / 1000).toString(),
            "X-RateLimit-Limit": options?.limit.toString() || "10",
            "X-RateLimit-Remaining": remaining.toString(),
            "X-RateLimit-Reset": resetTime.toString(),
          },
          status: 429,
        },
      );
    }

    const response = await handler(request);

    response.headers.set("X-RateLimit-Limit", options?.limit.toString() || "10");
    response.headers.set("X-RateLimit-Remaining", remaining.toString());
    response.headers.set("X-RateLimit-Reset", resetTime.toString());

    return response;
  };
}
