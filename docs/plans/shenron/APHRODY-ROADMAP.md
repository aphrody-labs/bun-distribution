<!-- SPDX-License-Identifier: Apache-2.0 -->

# Plan de convergence Shenron → Aphrody

Date de l’inventaire : 2026-09-29. Ce plan décrit le code présent dans le
workspace Aphrody, ses chemins de migration, les frontières de production et
les critères pour fermer la migration. Le checkout historique Shenron reste
intact jusqu’à la qualification de l’installation gelée et du cycle release/rollback.

## État vérifié

- Les neuf workspaces Bun actifs sont `apps/shenron/{bot,site}` et
  `packages/shenron/{api,auth,config,db,images,pipeline,ui}`. Le snapshot
  `_preview` est une copie de provenance, exclue des workspaces.
- Les neuf manifestes actifs déclarent TypeScript `7.0.2`. Les 1 848 fichiers
  TypeScript/TSX suivis ne contiennent aucun import direct `@radix-ui/*`.
  `@shenron/ui` s’appuie déjà sur `@base-ui/react@^1.8.0`.
- L’inventaire a relevé 605 imports des modules Node `node:*` dans le code suivi
  des applications et paquets : `path` 253, `fs` 235, `os` 47, `crypto` 31,
  `url` 25 et 14 autres imports. Ils doivent être classés avant remplacement.
- Les 146 scripts hors applications/paquets ont 138 fichiers TypeScript,
  quatre shell, deux PowerShell et deux manifestes JSON. Ils sont préservés
  sous `scripts/shenron/`; leurs chemins source ne sont pas tous exécutables
  depuis Aphrody sans remappage.
- Le catalogue Aphrody est maintenant utilisé pour les versions Shenron
  compatibles : `typescript` 7.0.2, `@types/bun` 1.4.2, `oxlint` 1.85.0,
  React 19.3, Zod 4.6.4 et AI SDK 7. Le lockfile résout `ai@7.0.116` et le
  provider Shenron `@ai-sdk/provider@4.0.18`; les workspaces Aphrody concernés
  passent le typecheck sous cette famille. Les écarts majeurs restants sont
  `graphql` 17 contre 16, `motion` 13 contre 12, et `@types/node` 26 contre 24.
  Ces écarts nécessitent une mise à niveau coordonnée, pas une substitution
  aveugle.
- Aphrody Infra possède déjà le catalogue et les adaptateurs de déploiement
  Shenron, les services, l’environnement local, les sauvegardes et les scripts
  d’import de configuration. Le bot héberge l’API publique ; le service API
  séparé et le serveur MCP Shenron sont retirés. Infra demeure propriétaire du
  runtime VPS et des opérations de bascule/rollback.

## Architecture cible

```text
apps/shenron/bot ───┐
apps/shenron/site ──┼──> packages/shenron/* ───> @aphrody/workspace (façade)
                    │                                  │
                    └──── API Shenron ────────────────┼──> aphrody-infra
                                                       ├── services/dev-env
                                                       ├── backup/maintenance
                                                       └── deploy Shenron, plan puis apply
```

- Shenron reste propriétaire de son contenu canonique, de PostgreSQL, de son
  API éditoriale, de ses droits serveur, du site et du bot.
- `@aphrody/workspace` expose le point d’entrée `shenron` pour inventorier les
  neuf workspaces, exécuter leurs scripts déclarés, auditer les scripts,
  appeler les workflows de consolidation et déléguer service/développement/
  déploiement à Aphrody Infra.
- Les clients Aphrody utilisent l’API Shenron et les outils `dragonball.*` déjà
  servis par `aphrody-mcp`; ils n’ouvrent pas PostgreSQL et ne transportent pas
  de secrets d’administration.
- Les données éditoriales, sauvegardes, unités, domaines, hôtes et releases ne
  sont jamais copiés dans les commandes Bun. Infra reste la source d’autorité.

## Commandes de convergence disponibles

Depuis la racine Aphrody :

```sh
bun packages/infra/aphrody-workspace/src/ops.ts shenron status
bun packages/infra/aphrody-workspace/src/ops.ts shenron scripts
bun packages/infra/aphrody-workspace/src/ops.ts shenron check lint
bun packages/infra/aphrody-workspace/src/ops.ts shenron check typecheck
bun packages/infra/aphrody-workspace/src/ops.ts shenron script @shenron/bot gen:entries
bun packages/infra/aphrody-workspace/src/ops.ts shenron audit
bun packages/infra/aphrody-workspace/src/ops.ts shenron migrate inventory
bun packages/infra/aphrody-workspace/src/ops.ts shenron migrate docs
bun packages/infra/aphrody-workspace/src/ops.ts shenron migrate scripts
bun packages/infra/aphrody-workspace/src/ops.ts shenron migrate infra
bun packages/infra/aphrody-workspace/src/ops.ts shenron service catalog
bun packages/infra/aphrody-workspace/src/ops.ts shenron service status --target local
bun packages/infra/aphrody-workspace/src/ops.ts shenron dev-env --target wsl-ubuntu-24.04
bun packages/infra/aphrody-workspace/src/ops.ts shenron deploy --target vps --release <release-path>
```

`migrate inventory` construit l’inventaire commun à partir de `~/src`.
Les imports `docs` et `scripts` sélectionnent ensuite le propriétaire Shenron,
vérifient les empreintes, respectent les cibles existantes et gardent les
conflits traçables. L’import `scripts` a copié 483 scripts Shenron vers
`scripts/tools/shenron`; l’index des commandes importées documente les chemins.
`migrate infra` importe uniquement les scripts de service gérés par
`aphrody-infra`; son catalogue et ses unités sont consommés via ses commandes.
Les scripts d’application ne sont exécutés que par leur nom déclaré dans un
manifeste. Les opérations de déploiement restent en mode plan Infra jusqu’à
l’option explicite `--apply`.

## Phases et critères de sortie

### S0 — Façade Aphrody et ownership

**État : implémenté dans `@aphrody/workspace`.** La façade `shenron` liste les
applications, paquets et scripts déclarés ; elle lance les étapes de qualité,
utilise le contrôle partagé de scripts et route les opérations de service,
d’environnement et de déploiement vers `aphrody-infra`. L’import d’inventaire,
de documentation et de scripts réutilise `consolidation.ts` avec un filtre de
propriétaire.

**Sortie :** workspace détecté depuis le root Aphrody, aucune commande shell
arbitraire, répertoire de travail déterminé par le manifeste, déploiement
toujours limité au stack `shenron`.

### S1 — Inventaire des tâches et déplacement des scripts

**État : inventaire régénéré, 483 scripts Shenron importés dans
`scripts/tools/shenron`, façade de commandes intégrée.** L’audit de sécurité
parcourt aussi les scripts de tous les workspaces actifs.
Les configurations Oxlint des paquets sont résolues depuis le bon
niveau et contournent l’exclusion globale `packages/**` de l’Aphrody root.
Le lint, le typecheck et les suites de tests de tous les 9 workspaces Shenron
(`@shenron/api`, `@shenron/auth`, `@shenron/bot`, `@shenron/config`, `@shenron/db`,
`@shenron/images`, `@shenron/pipeline`, `@shenron/site`, `@shenron/ui`) passent
à 100 % (0 erreur de lint, 0 erreur de typecheck, 2 100+ tests passants).
Les tâches runtime S1 (drain API et cron sur SIGTERM) et S2 (séparation sondes
liveness et readiness) sont implémentées et validées par leurs tests unitaires dédiés.

1. Régénérer l’inventaire avec les HEAD, états dirty, fichiers suivis/non suivis,
   licences, empreintes et chemins cible. Reclasser chaque script en
   `audit`, `build`, `dev`, `migration`, `release` ou `tools`.
2. Répartir les responsabilités : scripts de schéma dans `packages/shenron/db`,
   pipeline/RAG dans `packages/shenron/pipeline`, outils de bot/site dans leurs
   workspaces, et coordination transversale dans
   `packages/infra/aphrody-workspace/src/shenron/` (not in repo).
3. Migrer opérations, maintenance, synchronisations et vérifications vers des
   fonctions TS avec arguments typés et appels `Bun.spawn(argv, { cwd })` ;
   remplacer les scripts shell/PowerShell portables par ces fonctions lorsque
   Bun couvre l’API. Garder les unités, adaptateurs VPS, sauvegardes et gestes
   hôte dans Aphrody Infra.
4. Pour chaque script déplacé, corriger les imports relatifs, le cwd, les
   fichiers d’entrée et chemins d’assets ; enregistrer source, cible, hash,
   commande précédente et commande de remplacement. Retirer le snapshot de
   script uniquement après l’équivalence mesurée.
5. Séparer les tâches en lecture, génération locale, mutation de DB, accès
   réseau et opérations hôte. Les écritures éditoriales passent par les API ou
   commandes approuvées, jamais par un outil d’administration local ajouté au
   workspace. Les commandes d’Infra réutilisent les runbooks existants.

**Sortie :** aucun script invoqué par CI, développement, unités ou runbooks ne
dépend du checkout historique ; aucun chemin absolu de machine ; l’inventaire
du module couvre 100 % des scripts actifs et leurs propriétaires.

### S2 — Base UI et surface accessible

**État initial :** aucune référence Radix directe dans les sources/manifests des
workspaces actifs ; `@shenron/ui` utilise Base UI. L’historique officiel de
Base UI indique `1.8.0` comme version stable courante à la revue du 2026-09-29.

1. Auditer le graphe lockfile complet pour les dépendances Radix transitives et
   les anciennes primitives générées, en distinguant les outils CLI du runtime.
2. Détecter si shadcn CLI ou un ancien générateur réintroduit des composants
   Radix ; configurer/geler ses templates Base UI et retirer le générateur s’il
   ne sert plus.
3. Faire un audit d’accessibilité/comportement sur les composants réellement
   consommés : dialog, menu, select, tabs, popover, tooltip, toast, forms,
   clavier, focus, portals et layouts mobiles. Comparer le DOM et les
   interactions avant/après, puis conserver les composants maison utiles.
4. Garder une vérification CI qui échoue en cas d’import direct ou de
   dépendance runtime Radix ajoutée.

**Sortie :** zéro Radix runtime direct/transitif non justifié, composants
consommés issus de Base UI ou HTML natif, parcours clavier/focus validés.

### S3 — TypeScript 7 partout

**État initial :** les neuf workspaces actifs pinent `typescript@7.0.2`; npm
`latest` renvoie encore `7.0.2` à la date de revue. Garder
`@typescript/typescript6` uniquement pour les outils qui importent l’API du
compilateur TS6 : TypeScript 7.0 ne fournit pas d’API consommable et le paquet
compatibilité officiel sert à cet usage.

1. Remplacer les manifestes locaux par les références du catalogue Aphrody là
   où versions et pairs sont compatibles ; supprimer tout second compilateur
   5.x/6.x qui n’est pas une dépendance d’outil documentée.
2. Faire un inventaire des `tsconfig` racine, tests, scripts, Next, Bun et
   génération. Conserver les options nécessaires à Bun (`moduleResolution:
   bundler`, imports `.ts`, `verbatimModuleSyntax`, types Bun) et expliciter
   les options dont les valeurs par défaut TypeScript 7 changent.
3. Traiter `strict`, résolution de modules, types ambient, JSX, déclarations
   Next et API du compilateur comme migrations distinctes ; corriger les
   erreurs à la source plutôt que d’ajouter des casts ou d’assouplir le
   compilateur.
4. Ajouter le typecheck de tous les workspaces au gate Aphrody et vérifier les
   consommateurs externes des exports `@shenron/*` avec installation gelée dans le checkout existant.

**Sortie :** tous les fichiers source actifs typecheckent sous la version
TypeScript 7 stable du catalogue ; seule l’API TS6 requise par un outil est
isolée et justifiée.

### S4 — Bun natif et Web APIs

**État initial :** 605 imports `node:*` relevés dans les applications/paquets.
La documentation Bun actuelle fournit les API `Bun.file`, `Bun.write`,
`Bun.Glob`, `Bun.spawn`, `Bun.CryptoHasher`, `Bun.SQL`, `bun:sqlite` et
`Bun.RedisClient` ; Bun implémente aussi les standards Web.

Traiter par famille, en gardant un état « remplacer / garder avec motif » :

| Usages Node repérés | Cible à évaluer | Garde-fou |
| --- | --- | --- |
| `fs` (235), `path` (253) | `Bun.file`, `Bun.write`, `Bun.Glob`, `import.meta.dir`, `URL`/`fileURLToPath` | chemins relatifs au workspace, liens symboliques, atomique, permissions |
| `os` (47), `process` | `Bun.env`, `Bun.which`, API système standard | pas de secrets dans les logs, comportement WSL/Windows |
| `crypto` (31), `url` (25) | Web Crypto, `URL`, `Bun.CryptoHasher` pour hash serveur | formats historiques, streaming et compatibilité données |
| `child_process` (2) | `Bun.spawn` avec argv et cwd explicite | aucune interpolation shell ; arrêt/cancellation correctement propagés |
| HTTP/flux dans les apps | `fetch`, `Request`, `Response`, `Headers`, `ReadableStream`, `AbortSignal` | backpressure, timeout, retry, streaming et cache |
| PostgreSQL/SQLite | conserver Drizzle comme schéma/migration ; évaluer `Bun.SQL` et `bun:sqlite` derrière adaptateurs | transactions, extensions, lock, réplica, migration et performance réelle |

Ne pas remplacer des APIs par Bun au seul motif qu’elles existent. Next,
discord.js, Better Auth, Sharp, Drizzle et les drivers sont des frontières de
compatibilité ; adopter une API native uniquement si toutes les sémantiques
utilisées sont couvertes. Le serveur HTTP public reste sur l’architecture
validée (Hono monté dans le bot) jusqu’à une décision mesurée.

**Sortie :** inventaire résolu à 100 %, chaque compatibilité Node résiduelle
associée à une dépendance ou capacité précise ; pas de régression sur chemins,
annulation, flux, pooling, auth, données ni cibles OS.

### S5 — Catalogue de dépendances partagé et versions courantes

1. Pour chaque paquet direct, vérifier la dernière version stable publiée et
   ses exigences React/Next/Bun/TypeScript sur le registre et la documentation
   officiels, puis exécuter `bun outdated` par workspace. Les prereleases sont
   exclues sauf décision explicite. Respecter le délai d’âge de release Bun du
   root.
2. Les versions déjà compatibles utilisent `catalog:` : TypeScript, types
   Bun/React, React, Zod et oxlint. Répéter cette opération pour les
   dépendances partagées sans conflit. Le catalogue Aphrody est l’unique source
   pour ces versions.
3. Arbitrer les écarts majeurs en lots explicites : AI SDK 7 vs 6, GraphQL 17
   vs 16 et Motion 13 vs 12. Mettre à jour le catalogue et tous ses
   consommateurs Aphrody ensemble lorsque l’API est compatible ; sinon créer
   une compatibilité temporaire justifiée ou remonter la dépendance de Shenron
   au catalogue sans porter deux versions de runtime.
4. Examiner `@types/node` 26 contre le catalogue 24, Next 16, Tiptap,
   PostgreSQL, Better Auth, Hono et les adaptateurs UI. Supprimer les doubles
   dépendances et types seulement après validation des builds et des types.
5. Pour chaque lot : lockfile Bun stable unique, install gelée, contrôle des
   licences, typecheck, lint, tests ciblés, build des applications consommatrices
   et mesure du bundle/performance si pertinent.

**Sortie :** toutes les dépendances directes sont cataloguées ou possèdent une
exception motivée ; le lockfile résout une version partagée par famille quand
les contrats sont compatibles ; les mises à niveau majeures gardent un retour
arrière documenté.

### S6 — Fermeture du checkout et intégration de production

1. Régénérer les maps depuis les checkouts existants ; résoudre collisions,
   liens documentaires, licences, scripts et secrets ignorés. Ne pas inclure
   `.env`, bases locales, index/caches générés ou jeux de données protégés.
2. Qualifier le checkout Aphrody existant : install Bun gelé, scripts déclarés,
   format/lint/typecheck, tests appropriés, builds site/bot, import OpenAPI,
   codegen et assets. Vérifier les configurations locales par
   `aphrody-infra dev-env` et ses tunnels, sans secrets dans les manifests.
3. Préparer l’artefact Shenron avec Infra et comparer son contenu/empreintes à
   la release courante. Exécuter les sondes et le rollback sur cible de
   qualification ; conserver l’autorité des unités, domaines, données et
   sauvegardes dans Infra.
4. Ne retirer le checkout historique qu’après usage des chemins Aphrody par
   CI et consommateurs, sauvegarde vérifiée, release qualifiée et rollback
   confirmé. La migration de code ne déclenche jamais un déploiement implicite.

**Sortie :** source map fermée, qualification propre et reproductible, aucune
dépendance runtime aux chemins `~/src/shenron`, runbook de bascule et
retour arrière exercé par Aphrody Infra.

## Références de plateforme

- [Base UI releases](https://base-ui.com/react/overview/releases) — version
  stable et notes des composants.
- [Base UI accessibility](https://base-ui.com/react/overview/accessibility) —
  focus, clavier, labels et responsabilité visuelle.
- [TypeScript 7.0 officiel](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) —
  migration, changements de configuration et coexistence avec l’API TypeScript 6.
- [TypeScript latest au registre](https://registry.npmjs.org/typescript/latest) —
  `7.0.2` lors de la revue du 2026-09-29.
- [Bun APIs](https://bun.sh/docs/runtime/bun-apis) et
  [Bun TypeScript](https://bun.sh/docs/typescript) — APIs natives et types
  recommandés.
- [Aphrody Infra Shenron runbook](../../migration/SHENRON-WORKSPACE-LAYOUT.md)
  et checkout autoritaire `aphrody-infra/docs/SHENRON-MIGRATION.md` — limites
  du runtime/deploy et commandes existantes.
