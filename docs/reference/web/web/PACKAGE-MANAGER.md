<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Web dans la distribution Aphrody OS

Aphrody Web vit dans le dépôt `aphrody-code/aphrody-web`. Le service Web,
le pont Rust et le portail sont livrés avec Aphrody OS. Il n'existe plus de
release, de manifeste `aphrody-package.json`, d'installeur ni de commande
`self-update` pour un exécutable BXC autonome.

## Surfaces installées

- `aphrody-web-api` sert l'API Web locale sur loopback. `aphrody-site`
  relaie les routes Web autorisées sous `/api/v1/web/*`.
- `aphrody-web-ffi` fournit le pont Rust natif. Le build du workspace produit
  la bibliothèque propre à la plateforme (`.so`, `.dylib` ou `.dll`).
- `@aphrody/bxc` reste une bibliothèque Bun du workspace. Les shims `bin/bxc` (not in repo)
  et `bin/bxc.mjs` (not in repo) lancent uniquement la CLI source pour le développement ;
  le paquet ne publie plus de commande `bin`.

Le gestionnaire de paquets met à jour Aphrody OS comme une seule release.
Il ne cherche pas de tag, de checksum ou d'asset dans l'ancien dépôt BXC.
Les données utilisateur Web restent dans les chemins explicitement configurés
par Aphrody OS et ne sont pas effacées lors d'une mise à jour du code.

## Dépendances natives et validation

Depuis la racine d'un checkout Aphrody OS :

```bash
bun install --frozen-lockfile
bun apps/bxc/src/cli/index.ts install --full
cargo build --release --locked -p aphrody-web-ffi
```

`install --full` installe curl-impersonate et construit le pont Rust à partir du
workspace OS. Il ne télécharge pas d'archive BXC autonome. Le lancement du
service Web en production et les mises à jour passent par `aphrody-infra`.
