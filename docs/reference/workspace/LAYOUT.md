# Conventions du monorepo

`crates/<domaine>/<rôle>` contient une bibliothèque Rust ; `packages/<domaine>/<rôle>`
contient un package Bun/TypeScript ; `apps/<produit>` contient une application.
Le CLI général vit dans `crates/infra/aphrody`. Un domaine ne désigne pas le runtime client.

Les dossiers ne répètent pas le préfixe `aphrody-`. Les noms publics des packages
Cargo et `@aphrody/*` restent des contrats de compatibilité indépendants des
chemins. La famille M3 conserve son identifiant dans les noms de packages UI,
car le domaine UI contient aussi des composants indépendants de M3.

Les bibliothèques exportent des capacités sans démarrer de serveur à l’import.
Démarrage, configuration et processus appartiennent aux applications. Un calcul,
un chargeur natif ou un catalogue partagé possède un propriétaire canonique.

Le propriétaire de l’orchestration est `packages/infra/workspace`. Ses commandes
`repository-state`, `workspace-clean` et `pipeline-catalog` lisent le checkout
actuel. Les archives de migration documentent une histoire et ne définissent
pas les chemins actifs.

Sources : `Cargo.toml`, `package.json`, `PLAN.md` à la racine ; provenance des
renommages dans (removed import receipt) et `short-paths-2026-10-01.json`.
