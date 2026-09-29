# Carbon example OAuth configuration

The local example exposes two independent flows:

- `/oauth/login` requests only `identify`, checks the registered callback, and
  exchanges the authorization code for a profile. The access token is revoked
  immediately after the profile request. A Secure, HttpOnly, SameSite=Lax
  cookie identifies a one-hour server-side session containing only the user ID
  and display name. `/oauth/session` reads it; same-origin `POST /oauth/logout`
  deletes it. Sessions live in this process and end on restart.
- `/oauth/install` opens Discord's callback-free bot installation flow with
  `bot applications.commands`. It pins the configured guild. The development
  guild `1554189180030947338` requests Administrator bitfield `8`; other
  guilds request `0` until a narrower production permission profile is defined.

`/oauth/login` creates a random `state` bound to a Secure, HttpOnly,
SameSite=Lax cookie. The server accepts it once within five minutes and
consumes it before token exchange. A denial, mismatch, replay, or expiration
does not exchange a code. The callback clears the state cookie on every result.
The example retains no Discord access or refresh token. A failed revocation
does not create a local session.

| Scope | API or capability | Storage | Test | Discord approval |
| --- | --- | --- | --- | --- |
| `identify` | `GET /users/@me` during login | One-hour local profile session; OAuth token revoked | `oauth.test.ts` login, callback, replay, expiry, revoke | Standard scope |
| `bot` | Guild installation | No user token retained | `oauth.test.ts` installation URL | Standard scope |
| `applications.commands` | Command installation; `/ping` uses Carbon | No user token retained | `oauth.test.ts` URL and Carbon build | Standard scope |
| `webhook.incoming` | No webhook API implemented | None | Excluded from authorization URL | Not requested |
| Other user scopes | No corresponding API in this example | None | Excluded from authorization URL | Not requested |

Local RPC scopes, restricted scopes and unavailable scopes are absent from
these URLs. Discord's [OAuth2 reference](https://docs.discord.com/developers/topics/oauth2)
describes the authorization-code, bot-install and revocation endpoints.
Administrator grants guild permissions; it does not grant OAuth scopes or
privileged Gateway intents.

## Operational checks

- Register the exact `BASE_URL` callback `/oauth/callback` in the Developer
  Portal. The bot API cannot add this URI.
- Open `/oauth/login` in one browser and finish the callback in that browser.
  Check `/oauth/session`, then use same-origin `POST /oauth/logout`.
- Open `/oauth/install` separately. Validate permissions and commands in the
  test guild before defining a production permission profile.
- Release `084964f4a95c1d4231a75d282b61c371b4852120` is active on the
  development endpoint. Live probes verified the login and installation
  redirects, denial/replay, session rejection without a cookie and logout
  origin checks. A fresh authorized callback and rollback drill remain open.
- Release `4cf6332cdc66b3ec9c0f2b0c288f0a3024acf808` is now active. It
  limits `/oauth/login` to 60 attempts per minute per process and returns
  `429` with `Retry-After` before calling Discord. Local tests cover the
  window reset; live probes confirm the active release and OAuth redirects.
  A controlled rollback to the previous release and reactivation of this one
  both passed health and Gateway probes. Fresh user consent remains open.
