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
sources. Le préchargement complet reste incomplet ; les checkpoints permettent
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
- Clippy strict doit être relancé après la correction partagée de la
  documentation dans `crates/google/gemini-web/src/auth.rs`. Les deux contrôles
  TypeScript du site passent après ajout de l'import `aphrodyWebMirror` manquant
  dans `scripts/bxc-asset-harvest.ts`.
- Deux recherches consécutives ont indiqué `x-shenron-rag-cache: miss` : le
  fonctionnement du cache HTTP reste à qualifier.

Les suites de retrieval des façades compute, HTTP/wire, A2A, API publique,
corpus éditoriaux et bot ont été déplacées vers le gate partagé du RAG réel.
Les tests de politiques UI et de calculs purs ne qualifient pas le retrieval.
La fin de l'ingestion, la qualification du cache et l'évaluation complète
restent à effectuer. Le
binaire installé provient d'une construction de développement ; cette étape
ne constitue pas une qualification de production ni de toutes les plateformes.


## Lots Bun parallèles

Le premier lot UI/admin a corrigé le rendu sûr des extraits OCR, les onglets
inconnus, les états d'échec et de chargement, les réponses de rafraîchissement
obsolètes, les limites d'envoi OCR et les liens vers des pages absentes. Le
panneau local arrête la génération quand aucun passage n'est disponible ; les
sources précédentes sont effacées. Une frontière d'erreur protège le cockpit.

Validation d'intégration : 131 tests Bun réussis (332 assertions), les deux
contrôles TypeScript du site réussis, lint ciblé sans erreur, formatage des
nouveaux fichiers et `git diff --check` réussis. Les composants existants
gardent leur format propriétaire ; leur contrôle oxfmt global échouait déjà
avant ce lot. Aucun rendu navigateur ni déploiement du site n'a été effectué.

Les workers IA/Home dbfr, entraînement et admin agents/A2A travaillent sur des
claims disjoints, avec Bun/TypeScript uniquement. Les gates Cargo restent
sérialisés par l'intégrateur. Le worker Codex entraînement a échoué au
lancement (modèle incompatible avec son compte) ; le worker agy IA/Home a
terminé sans artefact. Ces deux lots ont été réattribués à Claude.
