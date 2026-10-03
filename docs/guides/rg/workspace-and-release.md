<!-- SPDX-License-Identifier: Apache-2.0 -->
# RG dans le workspace Aphrody

La racine propriétaire est Aphrody. `apps/rg` contient le site Next et le bot/API ;
`packages/rg` porte les contrats et bibliothèques partagés. Les anciens plans RG
importés décrivent leur état historique ; `AGENTS.md` et `PLAN.md` racine gouvernent
le checkout actuel.

## Producteurs IECODE

`config/sibling-checkouts.json` sélectionne une révision privée d'IECODE et les
producteurs Inagle, Inagle Cross et Azalée. Les consommateurs utilisent des
archives privées qualifiées par cette révision, sans membres workspace frères.

`bun run rg:pipeline` prépare un snapshot détaché de cette révision avant
l'installation frozen et les gates. Le checkout producteur courant est préservé,
y compris ses modifications. `APHRODY_IECODE_ROOT` choisit son emplacement.
La commande directe `bun run iecode:prepare` exige un checkout au pin ; pour
préparer depuis un checkout plus récent, utiliser :

```sh
bash scripts/rg/prepare-iecode-release.sh "$PWD" /chemin/vers/iecode
bun install --frozen-lockfile
```

Les archives sont immuables ; leur manifeste publié atomiquement porte révision,
état dirty, versions et SHA-256. Un conflit de contenu au même nom est refusé.

## Gates et bibliothèques

`bun run rg:pipeline:plan` décrit les gates sans les exécuter. Le pipeline prépare
les dépendances compilées (Discord Kit), puis contrôle imports, format, Oxc,
TypeScript, tests, builds et liens. Patreon est consommé sur npm, sans build local.
Le gate bot inclut `src` et `test` ; les suites SQL/live exigent leurs fixtures
explicites (`RG_TEST_DATABASE_URL` pour API/clans, `RANKED_TEST_DATABASE_URL`
pour isolation ranked, URL PostgreSQL loopback et
`RG_TEST_DATABASE_IS_DISPOSABLE=1`). Le preload du gate utilise uniquement
des identifiants synthétiques et une connexion loopback fermée sans fixture ;
ces valeurs ne s’appliquent jamais au runtime. Le test de contrat Achilléa contrôle les fichiers générés versionnés.

Cron exporte ses contrats sans démarrer de serveur. Son démarrage reste explicite
via `bun packages/rg/cron/src/index.ts` ou `startCronDaemon()`. Les handlers CDN,
Storage et Realtime restent importables ; l'application possède leur lancement.

## Release et activation

`scripts/rg/assemble-vps-release.sh <sha-complet>` assemble le commit Aphrody et
le pin IECODE. Le catalogue de services est figé avant lecture ; sa copie et son
hash figurent dans l'artefact et `release.json`. L'activation et la restauration
sont possédées par Infra. Un build ou un test ne prouve pas le comportement live :
SQL, configuration authentifiée, migrations, readiness et probes sont des gates
distincts. Les environnements privés restent dans leurs fichiers protégés.
