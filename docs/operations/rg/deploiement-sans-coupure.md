---
title: "Déploiement Website sans coupure"
description: "Publication bleu/vert de l'unique application Next Rose Griffon"
scope: ["website", "ops"]
status: "stable"
---

# Déploiement Website sans coupure

Le portail et le wiki Azalée sont publiés ensemble depuis `apps/rg/website`.
Cette procédure lance exactement **un build Next**, celui de Website.

```bash
bun run deploy website
bun run deploy:status
```

## Topologie

| Rôle | Unité | Port |
| --- | --- | --- |
| slot A | `website-web.service` | 3004 |
| slot B | `website-web-b.service` | 3014 |

Le slot inactif reçoit la nouvelle release, est sondé, puis nginx bascule le
trafic. L'ancien slot reste disponible pendant le drainage avant d'être arrêté.
Les releases immuables vivent sous `~/rg-releases/website/`.

## Séquence

1. Valider l'espace disque, la mémoire, les types et la configuration nginx.
2. Construire `@rosegriffon/website` une seule fois.
3. Assembler la release immuable, y compris les fragments statiques.
4. Démarrer et sonder le slot inactif sur des pages du portail et de `/wiki`.
5. Basculer nginx, attendre le drainage, puis stabiliser les slots.
6. Sonder `rosegriffon.fr` et la redirection `azalee.rosegriffon.fr` vers `/wiki`.

Un échec avant la bascule laisse la production actuelle intacte. Un retour
arrière repointe les slots Website vers une release antérieure ; il n'existe pas
de rollback Azalée distinct.

## Prévisualisation

La prévisualisation utilise le slot B de Website et le cookie `rg_preview`. Elle
inclut automatiquement le wiki, puisqu'il appartient à la même application.

```bash
bun scripts/ops/deploy.ts preview website
bun scripts/ops/deploy.ts promote website
bun scripts/ops/deploy.ts preview-off website
```

## Interdits

- Ne jamais lancer un second `next build` pour Azalée.
- Ne jamais recréer `azalee-web.service`, un slot `azalee`, un watchdog ou une
  release `rg-releases/azalee`.
- Ne pas transformer le domaine historique en proxy vers un processus autonome.
- Ne pas effacer les fichiers d'une release active ; publier une nouvelle
  release immuable puis basculer.

Le contrat complet de la surface wiki est dans [azalee.md](../../products/rg/azalee.md).
