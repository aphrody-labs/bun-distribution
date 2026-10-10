# Compatibilité Discord messaging

L’ancien paquet `@aphrody/messaging` a été absorbé par `@aphrody/discord-kit`.
Le point d’entrée maintenu est `@aphrody/discord-kit/messaging`; l’ancienne
entrée npm demeure une compatibilité historique et ne possède plus de source
distincte dans ce dépôt.

```ts
import { DiscordChannel } from "@aphrody/discord-kit/messaging";

const discord = DiscordChannel.fromEnv();
const sent = await discord.sendText("channel-id", "Hello");
console.log(sent.id);
```

L’implémentation et ses tests vivent dans `packages/discord/kit/src/messaging.ts`
et `packages/discord/kit/test/channel.test.ts`.
