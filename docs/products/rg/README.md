# Documentation — monorepo Rose Griffon

> 🌟 **SOURCE UNIQUE DE VÉRITÉ** : Le document de référence canonique pour la navigation, l'architecture unifiée des trois univers et le design system est [`PLAN.md`](../../../PLAN.md).

Index de la documentation partagée. Convention du dépôt : `*.md` est gitignoré
**sauf** `docs/**`, `PLAN.md`, les `README.md` de paquet et quelques exceptions listées
dans `.gitignore`.

## Architecture et données

| Doc | Portée |
| --- | --- |
| [PLAN.md](../../../PLAN.md) | **Source Unique de Vérité** : Navigation unifiée, 3 univers (Asso/Wiki/E-Sport), tokens `theme-achillea`, layouts & tests. |
| [database.md](../../architecture/rg/database.md) | Base de données et cache hybride : Postgres self-host ↔ miroir SQLite embarqué. |
| [decision-archi-donnees-azalee.md](../../decisions/rg/decision-archi-donnees-azalee.md) | Décision d'architecture : passage de la couche données d'Azalée sur Drizzle. |
| IECODE `docs/nie/architecture-unifiee-ievr.md` (not in repo) | Vue d'ensemble de la chaîne IEVR : extraction, stockage, rendu. |

## Wiki Azalée et bibliothèque

| Doc | Portée |
| --- | --- |
| [azalee.md](azalee.md) | Contrat canonique de la surface web : Azalée vit dans `apps/rg/website` sous `/wiki`, avec un seul build et aucune unité web autonome. |
| IECODE `docs/nie/azalee/azalee-lib.md` (not in repo) | `@rosegriffon/azalee` : cœur du wiki en bibliothèque Bun (racine client-safe, `/server`, `/remote`). |
| [wiki-filters.md](wiki-filters.md) | Filtres du wiki et contournement des colonnes NULL de `inagle_skills`. |

## Données du jeu (extraction)

| Doc | Portée |
| --- | --- |
| [gamedata-coverage.md](../../reference/rg/gamedata-coverage.md) | **Plan durable** de couverture de l'extraction : ce qui est parsé, poussé, ce qui manque. |
| IECODE `docs/nie/inagle/inagle.md` (not in repo) | `@rosegriffon/inagle` : parser binaire CPK/G4TX, API, pipeline. |
| IECODE `docs/nie/inagle/iecode-inagle-supabase.md` (not in repo) | Chaîne complète iecode → inagle → Supabase : tables, correspondances, procédures. |
| [chr.md](chr.md) | Format des modèles de personnage et assemblage 3D. |
| [lvl5.md](lvl5.md) | Formats propriétaires Level-5 : CPK, G4TX, cfgbin, gaiji. |

## Exploitation

| Doc | Portée |
| --- | --- |
| [PROD-STATUS.md](../../operations/rg/PROD-STATUS.md) | État vérifié de la production et surfaces retirées. |
| [deploy.md](../../operations/rg/deploy.md) | Déploiement et exploitation : services, procédures, diagnostic, interdits. |
| [deploiement-sans-coupure.md](../../operations/rg/deploiement-sans-coupure.md) | Publication bleu/vert : slots, versions, prévisualisation, et les trois pièges qui cassent une prod pendant un déploiement. |
| [self-host-supabase.md](../../operations/rg/self-host-supabase.md) | Sortie de Supabase : PostgreSQL local, PostgREST, Storage et Realtime auto-hébergés. |
| [bot-azalee.md](bot-azalee.md) | Second bot Discord (serveur Azalée) sur le même code que le bot Rose Griffon : profils, jeton, invitation, curseur d'annonce. |
| [bot-communaute.md](bot-communaute.md) | Niveaux sur la courbe du jeu, jetons Kizuna, collection de joueurs, tickets en fils privés. Hiérarchie stricte des récompenses de rôle et discrétion par défaut. |
| [bot-multicomptes.md](bot-multicomptes.md) | Rapprochement des comptes d'une même personne : indices observables, poids, seuils, verdicts du staff, et ce qui a été volontairement écarté. |
| [bot-format.md](bot-format.md) | Charte de présentation des deux bots : trousse `lib/ui`, couleurs, icônes, pagination, limites de l'API, patron d'une commande. |
| [bot-commandes.md](bot-commandes.md) | Catalogue définitif des slash commandes des deux bots : inventaire complet, bots tiers du serveur, convention de nommage, plan de bascule. |
| [bot-administration.md](bot-administration.md) | Surface web du bot : contrat de types partagé, serveur d'administration en boucle locale, API et pages `/admin/bot` + `/admin/cron`. |
| [campagnes-hashtag.md](campagnes-hashtag.md) | Campagnes à hashtag : récolte X + Discord, tolérance aux fautes de frappe, relais vers le salon de suivi. |
| [insta.md](insta.md) | Instagram : pourquoi aucune récolte automatique n'est possible, la vérification oEmbed, le dépôt manuel et la table dédiée. |
| `docs/ops/stockage-secondaire.md` (dépôt aphrody-infra) | Archive froide sur le second VPS : pourquoi elle a existé, ce qui en est revenu le 21/8/2026, et ce qui ne doit jamais être déporté. |
| [achillea-services.md](../../architecture/rg/achillea-services.md) | Topologie, secrets hors Git, ports, sondes et contrat d'upload Supabase d'Achillea. |
| [achillea-storage-migration.md](../../plans/rg/achillea-storage-migration.md) | Runbook sûr et reprenable pour migrer les octets Storage Cloud d'Achillea vers sa pile locale isolée. |
| [achillea-modulaire.md](../../architecture/rg/achillea-modulaire.md) | Architecture portable d'Achilléa : contrat, métier, client isomorphe, export Rust/Swift/Kotlin — et ce qu'il reste à faire pour migrer le front. |
| [achillea-bracket-validation.md](../../reference/rg/achillea-bracket-validation.md) | Contrat des brackets et preuves à relever en session réelle, sans inventer de résultats. |
| [achillea-migration-next.md](../../plans/rg/achillea-migration-next.md) | Plan de migration du front Achilléa (Angular) vers `apps/rg/website` (Next) : routes, phases, gardes et risques. |

## Écosystème

| Doc | Portée |
| --- | --- |
| [achillea.md](achillea.md) | Journal historique d'intégration ; architecture courante dans [achillea-migration-next.md](../../plans/rg/achillea-migration-next.md). |
| [assets-cdn.md](../../operations/rg/assets-cdn.md) | Contrat unique des assets partagés, des URL CDN et de leur publication. |
| [cloud-deployment.md](../../operations/rg/cloud-deployment.md) | Déploiement portable de Website sur Vercel, Fly.io ou Cloud Run, avec Supabase Cloud ou Neon. |

## Vérifier la documentation

```bash
bun run docs:check-links   # liens internes cassés
bun run docs:lint          # markdownlint
bun run docs:build         # les trois d'affilée
```
