<!-- SPDX-License-Identifier: Apache-2.0 -->

# Architecture Discord

Le paquet @aphrody/discord-kit est l’unique propriétaire Bun des capacités Discord partagées. Les intégrations métier restent dans leur dépôt produit, et les identifiants ainsi que les secrets restent dans leurs magasins protégés.

## Graphe des capacités

    Bun workspace catalog -> @aphrody/discord-kit
    @aphrody/discord-kit -> runtime partagé : intents, cycle de vie, gardes et cache
    @aphrody/discord-kit -> ./messaging
    @aphrody/discord-kit -> ./rest
    @aphrody/discord-kit -> ./apps
    ./messaging -> dépôts produits consommateurs

## Contrat

- packages/discord/kit/src/messaging.ts contient les contrats de canal et l’adaptateur REST.
- packages/discord/kit/src/index.ts contient le runtime partagé de bot.
- Les exports publics sont @aphrody/discord-kit/messaging, @aphrody/discord-kit/rest et @aphrody/discord-kit/apps.
- @aphrody/messaging n’a plus d’implémentation distincte ; les entrées historiques sont décrites dans la note de compatibilité des produits Discord.

## Portes

    bun run --filter @aphrody/discord-kit typecheck
    bun run --filter @aphrody/discord-kit test

La compilation, les permissions et l’activation de chaque bot sont vérifiées dans le dépôt propriétaire du consommateur. Cette documentation ne déclare aucun service distant comme activé.
