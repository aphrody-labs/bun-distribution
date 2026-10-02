# ADMIN-REPORTS.md — Registre des Signalements & Manques

> Fichier synchronisé en temps réel depuis SQLite (`admin_reports`) et le salon `🤖・lab-ia-admin`.
> Dernière synchronisation : 2026-09-25T00:00:00Z

## 1. Signalements Ouverts / En Cours

### Rapport 2026-09-25 — traduction databooks

- **Statut : INCOMPLET, arrêt propre.** Le run
  `databook-translation-20260924235829` a été arrêté après les lanes 1 et 2 ;
  le manifeste est `stopped` et aucun worker/tunnel ne reste actif.
- **PostgreSQL :** 470 ouvrages, 17 369 pages, 16 402 transcriptions JA,
  11 318 traductions FR ; 2 556 pages éligibles restent à traiter et 2 528
  sont quarantainées par le juge OCR/source.
- **RAG :** réindexation séparée terminée, 24 775 documents et 10 286
  traductions dans `apps/bot/data/rag/corpus-databooks.json` (not in repo).
- **Source réparée :** marqueurs Aphrody à largeur fixe et scan UTF-8 corrigé
  (`aphrody` `d2378c84`). Les tests ciblés Shenron passent ; la reprise doit
  commencer par les 2 528 pages source/OCR, puis relancer les 2 556 éligibles.

---

## 2. Historique des Signalements Résolus

| ID | Catégorie | Titre | Résolution | Date Résolution |
|:---:|:---:|:---|:---|:---:|
| **#22** | `auth/site` | Authentification Better Auth, accès API agents et connexion durable sans login | Résolu le 2026-09-27. Plugin `bearer()` activé dans `apps/shenron/site/src/lib/auth.ts`, session durable 30 jours configurée. `getCurrentUser()` et `resolveVisitor()` enrichis pour accepter le cookie signé `dbfr_admin`, `x-admin-token`, `Authorization: Bearer` (jeton maître, session Better Auth, ou clé d'agent `dbfr_agent_...` avec scopes d'écriture/modération). Formulaire `/admin-access` sécurisé (POST) sans transmission de jeton dans l'URL et cookie durable 30 jours ; CLI `aphrody shenron auth status/url/test` opérationnel (3 canaux validés HTTP 200). 100% tests unitaires et snapshots validés. | 9/27/2026 |
| **#21** | `manga/databook` | Sōshūhen Digest Edition Vol. 2 à 18 : planches DBFC (FR) substituées à tort au tirage B5 japonais | Corrigé le 2026-09-16. Les volumes Sōshūhen Legend 2 à 18 avaient été assemblés avec les planches de l'édition Dragon Ball Full Color française (DBFC) par ingest-soshuhen-all.ts. Les 7 605 fausses planches DBFC ont été purgées du disque (apps/site/public/wiki/databooks/soshuhen-legend-02..18/), les chapitres bot.db_manga_chapters (35002..35018) vidés et passés en visible = false (statut « À compléter »), et les databooks bot.db_databooks (469..485) réinitialisés avec leur couverture officielle Shueisha B5 sans planches intérieures falsifiées, dans l'attente des scans originaux du Weekly Shōnen Jump (posters dépliants, pages 4C/2C et dossiers Jump ERA). Legend 1 (Databook 465 / Ch. 35001) conserve ses 381 planches japonaises réelles. Traçabilité complète enregistrée dans wiki_revisions. | 9/16/2026 |
| **#19** | `site` | Slugs de transformations décalés (TRANSFORMATION_CANONICAL_SLUGS) | Corrigé le 2026-09-14 : TRANSFORMATION_CANONICAL_SLUGS réaligné sur les 23 IDs réels de bot.db_transformations (super-saiyan, super-saiyan-2..4, super-saiyan-god, super-saiyan-blue, super-saiyan-rose, fusion-potara, fusion-metamol, ultra-instinct, ultra-ego, beast, golden-freezer, black-freezer...), alias de compatibilité ajoutés pour les anciens slugs décalés, et test de validation automatique ajouté dans apps/site/scripts/check-wiki-slugs.ts (84 persos + 23 transfos validés avec 0 erreur). | 9/14/2026 |
| **#16** | `wiki` | Kai Final Chapters : la vidéo des fiches 4→70 n'est pas l'épisode décrit | Corrigé le 2026-09-13. Table fiche → épisode japonais générée (apps/bot/data/kai-final-correspondance.json : 59 fiches, 51 par titre ja.wikipedia + 8 par interpolation à pas égal). Lecteurs VOSTFR permutés sur l'épisode de chaque fiche (kai-final-realigner-vostfr.ts, sauvegarde dans data/export/) ; VF inchangée, déjà juste. Vérifié par trace.moe : fiche 40 VOSTFR → Kai (2014) ép. 32, fiche 65 → ép. 57. resolve-episode.ts (bxc) et import-kai-voiranime.ts suivent la table. Fiches 4,5,6,8,9,10,11,14,16,17 sans VOSTFR tant que leurs titres (signalement #15) ne sont pas corrigés ; 63→67, 69, 70 ont gagné une VOSTFR. Sous-titres japonais redéposés via jimaku-subtitles.ts --wikipedia. Mise à jour 2026-09-13 : fiches 8, 10 et 17 placées par dates de diffusion (en.wikipedia), VOSTFR reprises de la sauvegarde d'origine et sous-titres japonais déposés. Restent sans VOSTFR les fiches 4, 5, 6, 9, 11, 14, 16 et 68, épisodes internationaux non diffusés au Japon. | 9/13/2026 |
| **#15** | `wiki` | Kai Final Chapters : title_ja dupliqués ou absents sur 10 fiches | Arbitrage appliqué : fiches 4, 5, 9, 11, 14, 16 vidées de leurs faux title_ja, title_romaji et air_date dupliqués (épisodes internationaux non diffusés au Japon) avec révisions wiki_revisions ; table kai-final-correspondance.json et lecteurs VOSTFR réalignés, 58 pistes jimaku préservées. | 9/14/2026 |
