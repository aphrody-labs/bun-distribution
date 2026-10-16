/** `GET /auth/token` — jeton court destiné au client temps réel. */
export interface RealtimeTokenResponse {
  token: string;
  expiresIn: number;
  userId: string;
}
