# Documentation du Package `@rosegriffon/inagle`

Le package `@rosegriffon/inagle` (situé dans [packages/inagle/](file:///packages/inagle)) est l'API universelle et le moteur d'analyse de données de jeu pour **Inazuma Eleven: Victory Road (IEVR)** au sein du monorepo Rose Griffon.

Ce document présente l'architecture globale, le pipeline de données, l'alignement avec la base de données et les mécanismes de tests natifs.

---

## 1. Vue d'Ensemble & Architecture

`@rosegriffon/inagle` sert de couche d'abstraction de données (Data Access Layer) partagée par le wiki de l'application Next.js ([`apps/website`](../apps/website)) et les tâches périodiques du démon de fond (`packages/cron`).

### Structure du Code source ([packages/inagle/src](file:///packages/inagle/src))
```
packages/inagle/src/
├── adapters/          # Adaptateurs d'API Web (ex: Hono)
├── analysis/          # Logique d'analyse comparative de statistiques
├── api/               # Couche d'API de données globale
├── basara/            # Logique d'agrégation et parsing des données BASARA
├── characters/        # Gestion des personnages, de leurs stats et variantes
├── constellation/     # Gestion des constellations de personnages
├── core/              # Constantes, types de base et VFS
├── drops/             # Parsing des drops d'objets et de matchs
├── entities/          # Modélisation des entités de jeu (Character, Skill, Item, Team)
├── entries/           # Fichiers de données JSON compilés
├── menu/              # Logique des menus et interfaces
├── parsers/           # Moteurs de parsing de fichiers bruts du jeu
├── rag/               # Indexation et vectorisation pour le RAG
├── search/            # Index de recherche global et recherche floue
├── skills/            # Définitions des techniques actives, passives et auras
├── teams/             # Équipes et formations tactiques de jeu
└── utils/             # Transliteration romaji/kana, helpers utilitaires
```

---

## 2. API & Sous-modules Clés

### A. Gestion des Personnages & Variantes
* **Fichiers** : [entities/types.ts](file:///packages/inagle/src/entities/types.ts), [service.ts](file:///packages/inagle/src/service.ts)
* **Description** : Les personnages possèdent un `charaId` unique mais peuvent comporter plusieurs `variants` (loadouts, versions jeunes, versions spéciales).
* **Résolution de Rareté** : La fonction `loadBaseCharacters()` calcule dynamiquement la rareté globale d'un personnage de base en parcourant ses variantes pour retenir la meilleure rareté disponible (comme BASARA ou UR).

### B. Moteur de Stat Calculator
* **Fichiers** : [stat-calculator.ts](file:///packages/inagle/src/stat-calculator.ts)
* **Description** : Permet de calculer à la volée les statistiques d'un personnage à un niveau donné (1 à 99) en fonction de sa rareté, ses auras, et les boosts appliqués.

### C. Gestion BASARA & Signes Astrologiques
* **Fichiers** : [basara/index.js](file:///packages/inagle/src/basara/index.ts), [parsers/star-sign.ts](file:///packages/inagle/src/parsers/star-sign.ts)
* **Description** : Cartographie des loadouts de personnages BASARA et attribution de leur code de rareté `20`.

### D. Recherche Globale
* **Fichiers** : [search/index.js](file:///packages/inagle/src/search/index.ts)
* **Description** : Fournit une API de recherche unifiée (`GlobalSearchAPI`) indexant les personnages, techniques (skills) et objets du jeu.

---

## 3. Pipeline de Données & Synchronisation DB
Le pipeline permet d'extraire les données compilées et de les synchroniser avec la base de données PostgreSQL (Supabase) et le backup SQLite local.

* **Fichier clé** : [cli-push.ts](file:///packages/inagle/src/cli-push.ts)
* **Mécanisme de Fusion (`sheet_data`)** :
  Lors de la synchronisation vers la table `inagle_characters`, les métadonnées curatées hors-pipeline (comme les descriptions personnalisées de fiches de personnages) sont préservées. Les nouveaux movesets générés par le build JSON sont fusionnés intelligemment pour conserver les modifications dynamiques sans écraser les anciennes données :
  ```typescript
  sheet_data: (() => {
      const jsonSd = c.sheetData || {};
      const dbSd = preserved.get(c.charaParamId)?.sheet_data || {};
      const merged = { ...jsonSd, ...dbSd };
      if (!merged.moveset && jsonSd.moveset) {
          merged.moveset = jsonSd.moveset;
      }
      if (!merged.altMoveset && jsonSd.altMoveset) {
          merged.altMoveset = jsonSd.altMoveset;
      }
      return Object.keys(merged).length > 0 ? merged : null;
  })()
  ```

---

## 4. Tests d'Intégration Unifiés
Le package `inagle` est testé de manière autonome sous le runtime natif **Bun** pour valider l'exactitude du parser en conditions réelles sans nécessiter d'outils tiers comme Playwright.

* **Fichier de test** : [azalee-inagle-integration.test.ts](file:///packages/inagle/src/azalee-inagle-integration.test.ts)
* **Commandes** :
  ```bash
  # Lancer les tests d'intégration du package inagle
  bun test packages/inagle/src/azalee-inagle-integration.test.ts
  ```

### Couverture des Tests
1. **Accès VFS (Virtual File System)** : Valide le chargement correct des arborescences de répertoires virtuels de données.
2. **Vérification de la BD SQLite locale** : Valide l'existence et la taille (>10 Mo) du fichier de backup de données SQLite généré par le pipeline cron.
3. **Exactitude des Personnages** : Recherche et validation de l'intégrité de profils de personnages légendaires (ex: *Mark Evans* et *Axel Blaze*).
4. **Alignement SQLite vs Parsed JSON** : S'assure que le nombre de personnages et de techniques analysés est cohérent avec le nombre d'entrées contenues dans la base de données.
5. **Processus Azalée CLI** : Exécute de manière asynchrone le binaire `/home/ubuntu/.local/bin/azalee test` via les API de process Bun pour valider l'intégralité de la suite de tests natifs E2E (timeout étendu à 90 secondes pour accommoder la compilation Next.js en cours de route).
