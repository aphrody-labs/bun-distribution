# Carbon example OAuth configuration

The development login at `https://bot.aphrody.com/oauth/login` uses Discord's
authorization-code grant and advanced bot authorization. It creates a fresh
CSRF `state`, stores it in a Secure, HttpOnly, SameSite=Lax cookie, and sends
the user to the OAuth authorization page. Complete the consent flow in the same
browser so Discord returns the matching `state` and the browser sends its
cookie to `/oauth/callback`.

The current authorization request asks for these documented standard scopes:

```text
identify email connections guilds guilds.join guilds.members.read gdm.join bot
applications.commands applications.commands.permissions.update
applications.builds.read applications.store.update applications.entitlements
role_connections.write webhook.incoming
```

It targets the configured test guild, disables guild switching, and requests
bot permission bitfield `8` (`Administrator`). Administrator covers Discord
guild permission bits; it does not grant OAuth scopes, privileged Gateway
intents, or Discord partner approval.

Some requested names cannot be granted through this web flow:

| Scope                                                                                          | Discord status                                                                                      |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `rpc`, `rpc.notifications.read`, `rpc.voice.read`, `rpc.voice.write`, `messages.read`          | Local RPC scopes; Discord approval required. A VPS-hosted OAuth callback is not a local RPC server. |
| `activities.read`, `activities.write`                                                          | Listed as not currently available for apps.                                                         |
| `openid`, `rpc.video.read`, `rpc.video.write`, `rpc.screenshare.read`, `rpc.screenshare.write` | Not present in Discord's current OAuth2 scope list.                                                 |
| `applications.builds.upload`, `dm_channels.read`, `identify.premium`, `voice`                  | Require Discord approval.                                                                           |
| `relationships.read`                                                                           | Social SDK scope; requires applying for access and agreeing to its terms.                           |
| `applications.commands.update`                                                                 | Supported only with the client-credentials grant, not this user authorization-code flow.            |

Discord warns that requesting unapproved scopes can fail or behave
undocumented. Do not append restricted scopes to this authorization URL unless
Discord has approved them and a compatible local-RPC/Social-SDK feature is
implemented. The callback currently exchanges the code and displays the
authorized user's profile; it does not retain OAuth access/refresh tokens or
webhook credentials.

## Operational checks

- Register `https://bot.aphrody.com/oauth/callback` in the Developer Portal.
- Start authorization at `https://bot.aphrody.com/oauth/login`; do not open a
  callback URL directly or reuse a code from another authorization flow.
- The bot installation is pinned to `DISCORD_GUILD_ID`; grant the requested
  Administrator bit only in the development test guild.
- Gateway privileged intents remain controlled by Discord's application
  settings and the runtime intent mask; administrator permission does not
  enable them.
