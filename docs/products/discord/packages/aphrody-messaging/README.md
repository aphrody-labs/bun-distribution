# @aphrody/messaging

Bun-first TypeScript port of Aphrody's shared messaging channel contract and
Discord REST adapter. It has no runtime package dependencies; HTTP and multipart
uploads use Fetch APIs, while filesystem uploads use `Bun.file`.

```ts
import { DiscordChannel } from "@aphrody/messaging";

const discord = DiscordChannel.fromEnv();
const sent = await discord.sendText("channel-id", "Hello");
console.log(sent.id);
```

The required environment key is `DISCORD_BOT_TOKEN`. `rooms()` enumerates guild
channels, `openDm(userId)` resolves a private channel, and `streamInbox()` polls
guild text/thread history once per second. The stream is cancellable with an
`AbortSignal`.
