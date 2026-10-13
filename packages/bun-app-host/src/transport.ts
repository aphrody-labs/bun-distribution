// SPDX-License-Identifier: MIT
import { timingSafeEqual } from "node:crypto";
import { hashContent } from "@aphrody/bun-workspace";

export const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export function jsonReply(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: responseHeaders });
}

/** One authentication and origin policy for product and native app transports. */
export function authenticateRequest(request: Request, token: string): Response | undefined {
  if (token.length < 32) throw new Error("Inject the application token from its protected store.");
  const authorization = request.headers.get("Authorization");
  if (
    !authorization?.startsWith("Bearer ") ||
    !timingSafeEqual(
      new TextEncoder().encode(hashContent(authorization.slice(7))),
      new TextEncoder().encode(hashContent(token)),
    )
  )
    return jsonReply({ error: "Authentication required." }, 401);
  const url = new URL(request.url);
  if (
    request.headers.get("Sec-Fetch-Site") === "cross-site" ||
    (request.headers.get("Origin") && request.headers.get("Origin") !== url.origin)
  )
    return jsonReply({ error: "Origin denied." }, 403);
}
