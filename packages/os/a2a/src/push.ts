// SPDX-License-Identifier: Apache-2.0
/** Webhook side of push notifications (spec 4.3.3 and 13.2): decode and authenticate a delivery. */
import type { AuthenticationInfo, StreamResponse } from "./generated/a2a.ts";
import { asStreamResponse } from "./protocol.ts";

/** The body of a push notification is a `StreamResponse`: exactly one payload member. */
export function parsePushNotification(body: unknown): StreamResponse {
  return asStreamResponse(body);
}

function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Check the `Authorization` header of a delivery against the `authentication` the client gave in
 * the push notification config: `<scheme> <credentials>`, scheme compared case-insensitively
 * (RFC 9110), credentials in constant time. Anything else is rejected.
 */
export function verifyPushAuthorization(
  headers: Headers | Record<string, string | undefined>,
  expected: AuthenticationInfo,
): boolean {
  const received =
    headers instanceof Headers
      ? headers.get("authorization")
      : (headers.authorization ?? headers.Authorization);
  if (!received) return false;
  const space = received.indexOf(" ");
  if (space < 0) return false;
  const scheme = received.slice(0, space);
  const credentials = received.slice(space + 1).trim();
  return (
    scheme.toLowerCase() === expected.scheme.toLowerCase() &&
    constantTimeEqual(credentials, expected.credentials ?? "")
  );
}
