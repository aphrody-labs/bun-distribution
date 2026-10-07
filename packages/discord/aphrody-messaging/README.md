# @aphrody/messaging

Bun-first TypeScript port of Aphrody's shared messaging channel contract and
Discord REST adapter. It uses the maintained `@discordjs/rest` client for
authentication, rate limits, and retries. Filesystem uploads use `Bun.file`.

Builds emit ESM and declarations to `dist/`. Run `bun run typecheck`,
`bun run test`, and `bun run build` from this package before packing it.
The package remains private while the repository release gates and consumer
integration are completed.
TypeScript consumers should include `@types/node` for the `@discordjs/rest`
declarations.
The repository gate `bun run verify:messaging-pack` builds and packs this
package, installs the archive in a temporary project outside the workspace,
then checks runtime imports and TypeScript 7 declarations with NodeNext
resolution. The three build and publication workflows run this gate.

```ts
import { DiscordChannel } from '@aphrody/messaging';

const discord = DiscordChannel.fromEnv();
const sent = await discord.sendText('channel-id', 'Hello');
console.log(sent.id);
```

The required environment key is `DISCORD_BOT_TOKEN`. `rooms()` enumerates guild
channels, `openDm(userId)` resolves a private channel, and `streamInbox()` polls
guild text/thread history once per second. The stream is cancellable with an
`AbortSignal`, including during room discovery. It starts with the latest 100
messages per room and backfills later polls to the saved cursor when a channel
has more than 100 new messages. Discord's [message endpoint](https://docs.discord.com/developers/resources/message#get-channel-messages)
returns pages newest first.

## Implementation ownership

Discord messaging, REST, bot lifecycle and the private AI laboratory are implemented
in `packages/discord/kit`. `@aphrody/messaging` is a compatibility export of
`@aphrody/discord-kit/messaging`; it contains no separate transport. Laboratory
entrypoints are `src/lab/ai-lab.ts` and `src/lab/assistant.ts`. Discord transport
tests use the package Bun configuration to preserve native multipart primitives.
