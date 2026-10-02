# Bun package manager

Le dépôt utilise Bun `1.4.2`, épinglé par `packageManager` à la racine. `bun.lock`
est le lockfile canonique et doit être commité. Les workspaces sont déclarés
dans le `package.json` racine ; les dépendances internes utilisent
`workspace:*`, et les versions npm partagées utilisent le catalogue racine et
`catalog:`.

## Règles d'installation

- Après un clone ou une modification des dépendances : `bun ci`.
- Avant un commit de dépendances : `bun install --frozen-lockfile --dry-run` puis
  `bun run check:catalog`.
- Conserver le linker `hoisted` : le lancement du site en production attend
  `node_modules/next` (not in repo) à la racine.
- L'installation automatique à l'exécution est désactivée. Ajouter une
  dépendance nécessite donc une modification explicite du manifeste et du lock.
- Bun ne lance pas les scripts de cycle de vie des dépendances sauf confiance
  explicite via `trustedDependencies`. Ne pas élargir cette liste sans nécessité
  vérifiée.
- Les nouvelles résolutions observent un délai de quarantaine de trois jours.

## Modifier les dépendances

Ajouter une dépendance publique au catalogue partagé et au workspace concerné :

```sh
bun add zod --filter @shenron/site --catalog
bun add -d typescript --filter @shenron/site --catalog
```

Bun ajoute ou réutilise la version dans le catalogue racine et inscrit
`catalog:` dans le manifeste du workspace. Garder les dépendances réellement
spécifiques hors catalogue. Pour une dépendance interne, employer
`bun add @shenron/<package> --filter @shenron/<consumer>` puis vérifier que le
manifeste utilise `workspace:*`.

Après édition ou mise à jour :

```sh
bun run check:catalog
bun install --frozen-lockfile --dry-run
bun run deps:dedupe:check
bun run check:packages --strict
```

Ne pas éditer `bun.lock` à la main. Les workflows CI et release font
`bun ci`, équivalent à une installation avec lockfile figé.

## Audit et entretien

```sh
bun outdated                 # versions nouvelles disponibles, sans mise à jour
bun why <package>            # pourquoi une dépendance est présente
bun run deps:audit           # avis high/critical sur bun.lock
bun audit                    # inclut aussi low/moderate
bun dedupe                   # réécrit le lockfile pour réduire les versions dupliquées
```

`bun update` met à jour dans les plages déclarées ; le workflow hebdomadaire
ouvre une PR pour cette opération. `bun dedupe` et `bun audit fix` modifient le
lockfile : examiner leurs diffs, puis exécuter les contrôles de dépendances et
les vérifications CI avant de commiter.

## Workspaces

Utiliser `bun --filter <workspace>` pour une commande ciblée, par exemple
`bun --filter @shenron/site type-check`. `bun --filter '*'` cible tous les
workspaces, sans la racine. Les scripts racine qui agrègent les packages
passent par Turbo ou le filtre Bun déjà configuré.
