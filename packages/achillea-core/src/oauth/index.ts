/** Provider OAuth URL builders.
 *
 * Pure and runtime-neutral: persistence, secrets and Discord presentation stay
 * in the owning adapter while every client builds the same provider request.
 */
export type ProviderOAuthConfig = {
  callbackUrl: string;
  clientId: string;
  state: string;
  challongeScope?: string;
};

export interface ProviderOAuthState {
  discordId: string;
  token: string;
}

const PROVIDER_STATE_PATTERN = /^(?<discordId>\d{17,20}):(?<token>[a-f\d]{48})$/u;

export function formatProviderOAuthState(discordId: string, token: string): string {
  const value = `${discordId}:${token}`;
  if (!PROVIDER_STATE_PATTERN.test(value)) throw new Error("Invalid provider OAuth state");
  return value;
}

/** Parses the state used when linking a provider to an existing Discord user. */
export function parseProviderOAuthState(value: unknown): ProviderOAuthState | null {
  if (typeof value !== "string") return null;
  const match = PROVIDER_STATE_PATTERN.exec(value);
  const discordId = match?.groups?.discordId;
  const token = match?.groups?.token;
  if (!discordId || !token) return null;
  return { discordId, token };
}

export function buildTwitchOAuthUrl(config: ProviderOAuthConfig): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: `${config.callbackUrl}?provider=twitch`,
    response_type: "code",
    scope: "user:read:email",
    state: config.state,
  });
  return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
}

export function buildChallongeOAuthUrl(config: ProviderOAuthConfig): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: `${config.callbackUrl}?provider=challonge`,
    response_type: "code",
    scope: config.challongeScope ?? "me tournaments:read tournaments:write participants:write",
    state: config.state,
  });
  return `https://api.challonge.com/oauth/authorize?${params.toString()}`;
}
