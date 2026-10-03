<!-- SPDX-License-Identifier: Apache-2.0 -->

# Qualification du RAG Shenron — 2026-10-03

Le backend HTTP commun utilise le PostgreSQL éditorial Shenron via le tunnel
Infra, le PostgreSQL Supabase local avec pgvector dans un schéma privé, le
Redis Shenron via le même tunnel et le serveur natif E5 multilingue à 384
dimensions. Les identifiants restent dans le fichier d'environnement privé ;
aucun corpus, poids ou contenu de base n'est ajouté au dépôt.

La migration appartient à
[`crates/ai/rag/migrations/0001_shenron_postgres.sql`](../../../crates/ai/rag/migrations/0001_shenron_postgres.sql).
Les unités sous `config/systemd/user` décrivent le tunnel, le serveur E5 et la
synchronisation complète. Le timer de synchronisation est activé. Les rapports
et checkpoints restent sous le profil privé `dbfr`.

Le renderer PostgreSQL a produit environ 252 000 passages pour 33 sources.
Avec les exports éditoriaux privés disponibles, le synchroniseur déclare 50
sources. Le préchargement complet reste en cours ; les checkpoints permettent
de reprendre les sources terminées et les vecteurs compatibles sont réutilisés.

`bun run rag:prepare` prépare et vérifie le corpus complet.
`bun run rag:test`, depuis `packages/shenron/pipeline`, vérifie sa fraîcheur,
ses comptes PostgreSQL et vecteurs, Redis et la recherche réelle avant
d'exécuter les suites converties. Une préparation incomplète fait échouer le
contrôle au lieu d'utiliser des données simulées.

Contrôles observés :

- Construction native `aphrody-mcp` et contrôle Cargo ciblé réussis via le
  wrapper sérialisé ; 14 tests Rust HTTP réussis.
- Contrôles TypeScript du pipeline, du bot et des suites RAG ciblées réussis.
  Formatage ciblé, lint sans erreur, `git diff --check` et validation systemd
  réussis.
- Une recherche HTTP réelle retourne cinq résultats en mode `hybrid`.
- Le contrôle Bun du corpus complet échoue actuellement avec
  `Shenron RAG preload is incomplete or stale`.
- Clippy strict est bloqué par la documentation manquante d'une erreur dans
  `crates/google/gemini-web/src/auth.rs`. Le contrôle global TypeScript du site
  échoue sur `aphrodyWebMirror` dans `scripts/bxc-asset-harvest.ts`.
- Deux recherches consécutives ont indiqué `x-shenron-rag-cache: miss` : le
  fonctionnement du cache HTTP reste à qualifier.

La conversion de toutes les autres suites RAG, la fin de l'ingestion, la
qualification du cache et l'évaluation complète restent à effectuer. Le
binaire installé provient d'une construction de développement ; cette étape
ne constitue pas une qualification de production ni de toutes les plateformes.
