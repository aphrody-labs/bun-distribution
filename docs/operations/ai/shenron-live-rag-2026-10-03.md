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
- Clippy strict `aphrody-mcp --all-targets -- -D warnings` réussit après la
  correction partagée de la documentation dans `crates/google/gemini-web/src/auth.rs`. Les deux contrôles
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


## Reprise des statistiques et du préchargement

`/rag/stats` agrège désormais documents, vecteurs à jour et sources dans une
seule requête PostgreSQL, donc un même snapshot. Son délai de 20 secondes
convient à l'index complet ; un échec reste une indisponibilité explicite,
sans compte de vecteurs inventé à zéro. La recherche ponctuelle garde son
délai propre. Construction native sérialisée avec deux jobs réussie,
installation atomique puis 14 tests HTTP réussis.

La requête SQL a été exercée sur le PostgreSQL réel (47 725 passages,
47 433 vecteurs à jour, 50 groupes). Après installation, l'appel HTTP réel a
répondu en 83 ms (47 859 passages, 47 564 vecteurs). Les comptes sont des
observations pendant les écritures ; ils ne prouvent pas le préchargement
complet. `shenron-rag-sync.service` a repris, avec un PID Bun observé et une
progression réelle de la génération des références canoniques.


## Préparation et suivi des entraînements Bun

Le générateur de rollouts refuse les options invalides avant toute écriture,
borne les appels professeur et sauvegarde les lignes acceptées à SIGINT/SIGTERM.
Le suivi Discord enregistre un échec de lancement et attend le vidage borné
des sorties avant son statut final. Il autorise un entraînement à la fois.
L'évaluation chat comptabilise les refus et mentions d'IA indépendamment de la
longueur, et déclare `retrieval: "none"` ; elle ne qualifie pas le RAG.

Validation d'intégration : 25 tests du générateur/évaluateur et 11 tests de la
commande train réussis (123 assertions au total), TypeScript scripts et bot
réussis, lint des propriétaires sans erreur. Le format des fichiers existants
est préservé ; oxfmt échouait déjà sur ces fichiers avant les changements.
Aucun dataset privé n'a été modifié, aucun entraînement GPU ni promotion n'a
été lancé. Les suites RAG restent conditionnées au préchargement complet réel.


## IA et administration des agents

L'adaptateur chat omet un identifiant de modèle vide et signale les réglages
que le backend ne transmet pas. L'API IA distingue session absente (401) et
compte non administrateur (403), refuse les corps non objets et les tailles
d'évaluation invalides. Les lecteurs de clés/journal d'agents affichent leurs
pannes de base avec nouvelle tentative, sans les convertir en listes vides.

La console A2A utilise `/api/admin/a2a`, protégée par la session serveur ; elle
n'expose aucun jeton au navigateur et refuse les clés d'agents éditoriales.
Les ordres sont validés, les erreurs amont affichées et le polling sérialisé.
Une relance en file attend le retour de l'onglet visible ; un test de régression
a reproduit puis vérifié la correction de ce cas.

Validation d'intégration : 41 tests du lot admin agents/A2A, 27 tests UI/IA et
27 tests pipeline chat/provider/portabilité réussis ; 63 tests admin voisins
avaient passé avant le dernier cas de régression (aucun échec). TypeScript
site/tests et pipeline réussis ; lint ciblé sans erreur, formatage des nouveaux
fichiers réussi. Aucun navigateur authentifié ni déploiement Next n'a été
exercé. La route A2A des tests pointe sur un serveur Bun de contrat éphémère :
aucun ordre réel n'a été émis. Les tests de retrieval admin sont en conversion
vers le gate du RAG réel dans un lot distinct.


La suite `admin-ia-rag-live.test.ts` exerce désormais les statistiques, la
sonde, `test_prompt` et l'évaluation du cockpit avec le vrai transport et le
renderer manga PostgreSQL. Elle est incluse dans `rag:test`, qui isole les
suites dans des processus distincts. Les suites unitaires admin ne retournent
plus de résultats retrieval fabriqués : une garde refuse tout appel de
récupération ou d'évaluation dans ces suites. La dernière intégration unitaire
passe 89 tests (421 assertions). La suite live reste en échec avant ses tests
sur le gate « preload incomplete or stale » : aucun résultat live validé ni
préchargement complet n'est revendiqué.
