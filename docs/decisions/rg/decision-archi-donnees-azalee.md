# Décision : architecture de données azalée

Statut : REMPLACÉE — 2026-09-22. La décision historique ci-dessous est conservée
pour traçabilité ; la cible actuelle est PostgreSQL durable + SQL partagé.

## Architecture actuelle

- Les projections `inagle_*`, le texte, le CPK, la recherche et les lectures wiki
  runtime viennent de PostgreSQL via `@rosegriffon/db`/Kysely.
- `@rosegriffon/db/postgres-client` ne fournit qu’une façade de migration vers
  ce même PostgreSQL ; il n’existe pas de backend Supabase ou SQLite parallèle.
- SQLite est réservé aux imports, à l’extraction et au développement hors ligne.
- Le publisher peut produire un miroir SQLite de travail, mais ce miroir n’est
  jamais la source de vérité ni un fallback silencieux du runtime durable.

Les sections suivantes décrivent l’ancienne stratégie hybride et ne doivent plus
être utilisées pour implémenter de nouveaux chemins.

## État d'implémentation

- **Miroir** : le publisher `niers` reste un outil d’extraction/dev ; son SQLite
  n’est jamais consommé comme source runtime durable.
- **Accès données** : les projections runtime passent par PostgreSQL via Kysely
  et les façades SQL partagées `@rosegriffon/db`. Aucun `SqliteQueryBuilder` ne
  réimplémente la surface PostgREST en production.
- **Rendu** : les six fiches détail `/chara`, `/skill`, `/item`, `/passive`,
  `/tactic` et `/aura` sont en ISR horaire avec `dynamicParams=true`; les listes,
  filtres, comptes et surfaces authentifiées restent dynamiques.
- **Invalidation** : `POST /api/ops/revalidate/wiki` est protégé par
  `AZALEE_REVALIDATE_SECRET`. Le câblage du publisher externe à cette route reste
  une opération de déploiement, pas une dépendance silencieuse de l'application.

## 1. Contexte

> **Mise à jour 2026-09-20 :** la topologie frontend décrite dans la décision
> originale est retirée. Azalée est maintenant servie par `apps/website` sous
> `/wiki`, avec le seul build Website. Les choix de couche de données ci-dessous
> restent une trace de décision, mais aucune mention d'`azalee-web` ne constitue
> une instruction d'exploitation actuelle. Voir [azalee.md](azalee.md).

Azalée est un wiki IEVR public, read-heavy, intégré à l'application Website. La donnée de jeu = ~44-63 tables `inagle_*` STATIQUES (ne changent qu'à un re-dump du jeu) : ~6148 personnages (5204 base_slug), ~1002 skills, ~1668 items, auras/keshins/tactics, etc. → des milliers de pages adressables.

Source de vérité = projections PostgreSQL alimentées par Inagle. Le publisher
`niers` ne produit qu’un artefact SQLite d’extraction/dev ; il n’existe aucun
fallback SQLite silencieux dans le runtime.
- **Rendu** : les fiches détail `/skill /item /aura /tactic /chara` sont en ISR horaire, avec les chemins restants rendus à la demande ; les listes, filtres et surfaces authentifiées restent dynamiques.

Les anciens incidents Supabase restent documentés pour l’historique ; ils ne
justifient plus une seconde source de vérité, puisque les lectures durables
passent par PostgreSQL direct.

Fragilités historiques du miroir corrigées : `SQLITE_DB_PATH` est maintenant épinglé sur le chemin canonique et `nie-miroir.timer` valide puis publie les snapshots. Les anciens fichiers de `data/backups/` peuvent encore contenir de la PII et restent donc un repli local à purger selon la politique de rétention, jamais une source de production.

## 2. Axes de durabilité évalués

Ces axes appartiennent à la décision historique. La décision actuelle est la
réduction des couches : PostgreSQL durable, SQL partagé, SQLite extraction/dev.

## 3. Options comparées

(a) Supabase direct runtime · (b) Postgres local VPS · (c) SSG/ISR statique seul · (d) SQLite réparé + auto-refresh + Drizzle · (e) Hybride (c)+(d) durcis. Voir tableau comparatif.

## 4. Décision

**La décision historique retenait un hybride. Elle est remplacée par la cible
SQL/PostgreSQL décrite en tête de ce document.**

1. **Couche data → Drizzle ORM** (tue les 494 LOC d'émulation PostgREST). Le schéma partagé couvre les lecteurs Node/Bun derrière le garde `typeof Bun`; le runtime frontend actuel est Website.
2. **Sync → industrialiser le miroir** (tue le snapshot périmé) : épingler `SQLITE_DB_PATH` (chemin stable `mirror.sqlite`) + publisher systemd quotidien post-`inagle push` (dump validé → swap atomique → purge de rétention). Le lecteur rouvre son handle sans redémarrage.
3. **Rendu → ISR** (tue le rendu dynamique de donnée immuable) : pages-détail wiki de `force-dynamic` vers `revalidate=3600` + invalidation on-demand, `dynamicParams=true`, pré-rendu borné (PAS de SSG complet : milliers de pages × build SIGILL = inacceptable).

Supabase reste : (i) fallback durci (pooler Supavisor session-mode IPv4) pour le wiki ; (ii) source de vérité UNIQUE pour RAG pgvector, 6 RPC PostgREST, auth Better Auth, éditorial/social (non découplables par le miroir, par design).

## 5. Justification (durabilité)

- **Résilience (axe prioritaire)** : double découplage — HTML ISR caché + data locale SQLite. Une fiche cachée ne touche ni miroir ni Supabase à la requête → immunité aux fragilités IPv6/env scellé/login 500.
- **Maintenabilité** : Drizzle supprime l'émulation PostgREST fragile (parser .or() splitTopLevel, *_clean GROUP BY, NULLS FIRST/LAST) ; typage introspecté de bout en bout.
- **Fraîcheur** : publication quotidienne validée, swap atomique et détection d'inode sans restart ; invalidation ISR on-demand au swap.
- **Pérennité** : ISR stable depuis v13 ; PostgreSQL/Kysely est la couche
  durable ; SQLite reste un format portable réservé aux imports et à l’extraction
  hors ligne.
- **Ops** : 1 timer + 1 var d'env + 1 purge, homogène avec l'infra cron existante (1 seul VPS, pas de Redis, pas de 2e Postgres).

## 6. Chemin de migration (prod-safe, non destructif)

Voir `migration_path` : Phase 0 (épinglage + DATABASE_URL pooler + purge tronqués, réversible) → Phase 1 (valider épinglage, restart isolé) → Phase 2 (timer auto-refresh) → Phase 3 (exclure PII du dump) → Phase 4 (Drizzle derrière façade, 0 touche aux 1445 call-sites) → Phase 5 (ISR route par route) → Phase 6 (retirer la façade). Chaque phase validée en prod avant la suivante, rollback trivial par phase. JAMAIS de ship/restart en masse, JAMAIS `rm -rf .next/cache` d'un émetteur servi.

## 7. Risques

Voir `risks` : swap sous connexion readonly (reload WAL à chaud vs rename d'inode), parité sémantique de la façade Drizzle (diff vs oracle SqliteQueryBuilder), fallback Supabase durci indispensable, build Next16 fragile, écart volumétrie skills 1002 vs 2900 à vérifier par COUNT, disque à 94% (purge obligatoire), drizzle-kit pull à régénérer au re-dump, invalidation ISR à câbler explicitement au timer.
