# Conventions du monorepo

`crates/<domaine>/<rôle>` contient une bibliothèque Rust ; `packages/<domaine>/<rôle>`
contient un package Bun/TypeScript. Les surfaces produit vivent dans leur
propriétaire de capacité ; il n’existe pas de dossier applicatif `apps/` à la racine.
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

Les scripts sont rangés sous `scripts/{audit,build,dev,migration,release,tools}` ;
les lanceurs du checkout vivent sous `scripts/dev/cli`. Les documents suivent
`docs/<catégorie>/<domaine>` et les configurations opérationnelles `tools/config`.

Les index documentaires générés ne lisent que les fichiers suivis par Git.
Les brouillons non suivis restent propres à leur session ; ajouter explicitement
un nouveau document à Git avant de régénérer les index.

Sources : [Cargo.toml](../../Cargo.toml), [package.json](../../package.json),
[PLAN.md](../../PLAN.md) et [AGENTS.md](../../AGENTS.md).
