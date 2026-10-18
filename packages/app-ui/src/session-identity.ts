// SPDX-License-Identifier: Apache-2.0
/** Public projection of the existing Rust GetAccountResponse contract. No credentials are retained. */
export interface SessionIdentity { authMode: "oss" | "apikey" | "chatgpt" | "headers" | null; }
export function sessionIdentity(value: unknown): SessionIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid account response.");
  const mode = (value as Record<string, unknown>).authMode;
  if (mode !== null && (typeof mode !== "string" || !["oss", "apikey", "chatgpt", "headers"].includes(mode))) throw new Error("Invalid account authentication mode.");
  return { authMode: mode as SessionIdentity["authMode"] };
}
export async function readSessionIdentity(
  initialize: () => Promise<void>,
  rpc: (method: string, params: Record<string, unknown>) => Promise<unknown>,
): Promise<SessionIdentity> {
  await initialize();
  return sessionIdentity(await rpc("account/read", {}));
}
