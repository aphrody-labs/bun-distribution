# Rose Griffon — Application Unifiée

Application Next.js 16 unifiée de **Rose Griffon** (`rosegriffon.fr`), fusionnant l'ancien portail associatif et l'ensemble de la base de données / wiki **Azalée** (_Inazuma Eleven: Victory Road_), le système de publication des Chroniques et d'actualités, et l'espace d'administration.

---

## Architecture des Routes

### 1. Portail Principal & Vie Associative

- `/` : Accueil, actualités en une, prochains événements, liens communautaires.
- `/community` : Hub communautaire, intégration Discord, liens sociaux.
- `/shop` : Boutique associative et goodies.
- `/notre-equipe` : Présentation de l'équipe, de l'association et des partenaires.
- `/a-propos` : Charte, histoire, engagements et contact.
- `/sondages` : Système de sondages communautaires.

### 2. Base de Données & Wiki (_Inazuma Eleven: Victory Road_) — `/wiki`

- `/wiki` : Portail d'accueil du wiki (recherche globale, nouveautés, raccourcis).
- `/wiki/chara` : Annuaire complet des 5 930+ joueurs (cartes, heptagone de stats, raretés, variantes).
- `/wiki/skill` : Catalogue des techniques spéciales et arbres d'évolution.
- `/wiki/aura` : Les 5 familles d'auras (Esprits Guerriers, Totems, Mixi-Max, Éveil, Changement de Mode).
- `/wiki/equipe` : Équipes et formations du jeu.
- `/wiki/item` : Objets, consommables et équipements.
- `/wiki/boutique` : Magasins et inventaires du jeu.
- `/wiki/capsule` & `/wiki/invocation` : Distributeurs de capsules et tirages.
- `/wiki/drops` : Tables de butin et probabilités réelles.
- `/wiki/quete` : Missions et quêtes principales / secondaires.
- `/wiki/niveau` : Courbe d'expérience et calculateurs de montée de niveau.
- `/wiki/succes` : Trophées et succès à débloquer.
- `/wiki/gallery` & `/wiki/textures` : Galerie d'illustrations et textures brutes du jeu.
- `/wiki/sons` & `/wiki/videos` : Banques de voix / bruitages et cinématiques.
- `/wiki/modeles` : Visualiseur de modèles 3D (VRM / GLB Three.js).
- `/wiki/tools` : Boîte à outils (comparateur de joueurs, générateur d'équipe aléatoire, team builder, traducteur de texte).
- `/wiki/save` : Lecteur et analyseur de sauvegardes IEVR.
- `/wiki/cross` : Passerelle Inazuma Eleven Cross.

### 3. Chroniques & Actualités — `/chroniques` et `/news`

- Fusion complète des actualités Azalée (`app = 'azalee'`) et des Chroniques du Bouquet (`app = 'website'`).
- Support universel du format Lexical JSON AST et de l'ancien HTML brut via `LexicalRenderer`.
- Catégories combinées : `official`, `community`, `esport`, `guides`, `association`, `announcement`, `event`, `critique`.
- Commentaires unifiés, likes, fils de discussion imbriqués et intégration des tweets officiels.

### 4. Tableau de Bord d'Administration — `/admin`

- `/admin` : Vue d'ensemble et métriques.
- `/admin/news` : Éditeur d'articles Lexical avec gestion des brouillons, programmation et versions.
- `/admin/database` : Explorateur et éditeur direct des tables Supabase / PostgreSQL.
- `/admin/tweets` : Synchronisation et modération des tweets importés.
- `/admin/import-sheet` & `/admin/import-google-doc` : Outils d'ingestion Google Sheets et Docs.
- `/admin/audit` : Journal d'audit complet de toutes les actions d'administration.
- `/admin/zukan-review` : Revue et validation des données du Zukan.
- `/admin/users` & `/admin/staff` : Gestion des rôles, permissions et membres.

---

## Compatibilité & Rétro-compatibilité Nginx

Toutes les anciennes URLs `https://azalee.rosegriffon.fr/*` sont préservées sans régression :

- `https://azalee.rosegriffon.fr/` ➔ `https://rosegriffon.fr/wiki` (301 Permanent).
- `https://azalee.rosegriffon.fr/<section>/...` ➔ `https://rosegriffon.fr/wiki/<section>/...` (301 Permanent).
- `https://azalee.rosegriffon.fr/news/...` ➔ `https://rosegriffon.fr/news/...` (301 Permanent).
- `https://azalee.rosegriffon.fr/dashboard/...` ➔ `https://rosegriffon.fr/admin/...` (301 Permanent).
- `https://azalee.rosegriffon.fr/api/...` ➔ proxifié directement vers le backend unifié (préservation des requêtes POST, PUT, webhooks et bots Discord).

---

## Commandes de Développement & Production

```bash
# Lancer en développement
bun run dev

# Tester la compilation de production
bun run build

# Déployer en production (bleu/vert sans coupure)
bun scripts/ops/deploy.ts deploy website --no-build --no-gate
```
