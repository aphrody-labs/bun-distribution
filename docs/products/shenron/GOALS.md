# GOALS.md — Objectifs & Feuille de Route de Session

> Ce document est synchronisé en temps réel depuis la base de données (`admin_goals`) et les directives Discord des administrateurs.
> **Agents IA (Claude, AGY, Codex)** : Au début de chaque session, lisez attentivement ce fichier pour déterminer la tâche prioritaire à accomplir.
> Dernière synchronisation : 2026-09-14T11:24:45.955Z

## 1. Objectifs Prioritaires Actifs

*Aucun objectif actif. Tous les objectifs de session sont accomplis.*

---

## 2. Objectifs Complétés

| ID | Titre | Date Réalisation | Bilan |
|:---:|:---|:---:|:---|
| **#22** | Authentification souveraine durable & alignement Better Auth / PostgreSQL / Aphrody CLI | 9/27/2026 | Better Auth (`apps/shenron/site/src/lib/auth.ts`) enrichi du plugin `bearer()` et de sessions durables 30 jours ; `getCurrentUser()` et `resolveVisitor()` gèrent le cookie signé `dbfr_admin`, `x-admin-token`, `Authorization: Bearer` (jeton maître, Better Auth, ou AgentKey `dbfr_agent_...` avec scopes d'administration). Formulaire `/admin-access` avec connexion durable sans mot de passe (sans secret dans l'URL) ; CLI `aphrody shenron auth status/url/test` opérationnel (3 canaux validés HTTP 200). 100% tests et types validés. |
| **#20** | Couverture maximale : data et médias sur toutes les pages | 9/14/2026 | Audit champ par champ et médias exécuté (apps/site/scripts/audit-wiki-couverture.ts). 121 assets officiels ingérés (MyInstants SFX + dragonball-api). 100% synopsis_fr sur 826 épisodes et 28 films. 100% images/covers sur planètes, sagas, transformations, films, jeux, databooks, manga. Données assainies sans invention. |
