<!-- SPDX-License-Identifier: Apache-2.0 -->
# Spécification Canonique de l'API Unifiée Rose Griffon

Ce document fournit la spécification exhaustive et contractuelle de l'**API unifiée Rose Griffon** (`apps/rg/bot/src/api`).
Il couvre l'ensemble des 153 points d'accès HTTP et WebSocket consolidés sur le port interne `:8800` (exposé publiquement via Nginx sur `https://api.rosegriffon.fr`).

---

## 1. Principes Directeurs & Protocole Réseau

1. **Serveur Unique & Runtime** : Développé avec [ElysiaJS](https://elysiajs.com) sous [Bun](https://bun.sh) (>=1.4.2), intégré dans le même processus démon que le bot Discord Rose Griffon ([`apps/rg/bot`](../../../apps/rg/bot)).
2. **Typage Contrat Zéro-Coût** : L'API expose le type TypeScript `App` (`typeof app`), exploité côté client web et CLI par Eden Treaty (`@elysia/eden`). Tout changement d'endpoint ou de schéma TypeBox est répercuté statiquement au build.
3. **Sérialisation & Validation** : Validation à l'entrée par schémas stricts TypeBox (`t.Object`, `t.String`, `t.Numeric`, `t.Boolean`, `t.Optional`).
4. **Documentation Interactive** : Spécification OpenAPI / Swagger UI accessible directement sur `/docs`.

---

## 2. Authentification & Sécurité

L'API gère quatre vecteurs d'authentification complémentaires :

### 2.1. Sessions Better Auth (`/api/auth/*`)
- Montage direct du handler Better Auth (`elysiaAuth.handler`).
- Cookies HTTP-Only signés (`rg_session`), partagés entre les sous-domaines `rosegriffon.fr` et `api.rosegriffon.fr`.
- Prise en charge des flux OAuth Discord, Twitch, Challonge et des Passkeys FIDO2.

### 2.2. Jetons de Session Achilléa (`/v1/auth/session/exchange`)
- Échange de jetons pour le client mobile, desktop ou les Workers d'arrière-plan.
- Signature cryptographique HMAC-SHA256 validée par `@rosegriffon/auth/achillea-session`.

### 2.3. Accès Agent & MCP (`/.well-known/agent-configuration`, `/v1/auth/capability/list`)
- Découverte automatique des capacités agent et configuration OAuth pour agents IA autonomes (Claude, Codex, Antigravity/agy).
- Clés d'API d'agents gérées via `/v1/auth/api-key/create`.

### 2.4. Jetons d'Administration & Secrets Internes
- En-têtes acceptés pour les opérations d'administration et les webhooks :
  - `Authorization: Bearer <API_ADMIN_TOKEN>`
  - `X-Internal-Secret: <INTERNAL_SERVICE_SECRET>`
  - `X-Api-Key: <BOT_API_KEY>`

---

## 3. Matrice Exhaustive des Routes

### 3.1. Routes Racine & Système

| Méthode | Chemin | Description | Validation / Sécurité |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Bilan de santé (uptime, timestamp, statut) | Public |
| `GET` | `/docs` | Documentation Swagger / OpenAPI interactive | Public |
| `GET` | `/.well-known/agent-configuration` | Découverte de configuration agent / IA | Public |
| `ALL` | `/api/auth/*` | Montage du routeur d'authentification Better Auth | Public / Session |

---

### 3.2. Surface Esport & Tournois Achilléa (`/v1/achillea/*`)

Le module Achilléa regroupe 22 contrôleurs couvrant les compétitions Inazuma Eleven.

#### A. Tournois & Événements (`/v1/achillea/tournaments`)
- `GET /v1/achillea/tournaments` : Liste paginée des tournois actifs, archivés et à venir. Filtres : `game`, `status`, `page`, `limit`.
- `GET /v1/achillea/tournaments/:id` : Détails d'un tournoi (règles, phases, dates, organisateurs).
- `POST /v1/achillea/tournaments/:id/register` : Inscription d'un joueur ou d'une équipe.
- `DELETE /v1/achillea/tournaments/:id/register` : Désinscription d'un tournoi.
- `GET /v1/achillea/tournaments/:id/participants` : Liste des participants validés et en liste d'attente.
- `GET /v1/achillea/tournaments/:id/matches` : Arbre des matchs (brackets simples, doubles, rondes suisses).
- `POST /v1/achillea/tournaments/:id/matches/:matchId/score` : Rapport de score d'un match par les capitaines.
- `POST /v1/achillea/tournaments/:id/matches/:matchId/confirm` : Confirmation du score adverse.

#### B. Ranked & Compétitif (`/v1/achillea/ranked`)
- `POST /v1/achillea/ranked/queue` : Entrée en file de matchmaking ELO classée.
- `DELETE /v1/achillea/ranked/queue` : Sortie de la file d'attente.
- `GET /v1/achillea/ranked/status` : Statut en direct du matchmaking pour l'utilisateur authentifié.
- `GET /v1/achillea/ranked/matches/:id` : Détail d'un match ranked (équipes, règles, état du litige).
- `POST /v1/achillea/ranked/matches/:id/submit` : Soumission de la preuve de victoire (screenshots/vidéos).
- `POST /v1/achillea/ranked/matches/:id/dispute` : Ouverture d'un litige arbitrage.

#### C. Classements & Saisons (`/v1/achillea/leaderboard`)
- `GET /v1/achillea/leaderboard/global` : Classement ELO mondial tous formats confondus.
- `GET /v1/achillea/leaderboard/season/:seasonId` : Classement spécifique à une saison compétitive.
- `GET /v1/achillea/leaderboard/user/:userId` : Position et historique ELO d'un joueur.

#### D. Clans & Organisations (`/v1/achillea/clans`, `/v1/achillea/organizations`)
- `GET /v1/achillea/clans` : Liste des clans actifs, triés par niveau et points d'expérience.
- `POST /v1/achillea/clans` : Création d'un nouveau clan (nom, tag, description, blason).
- `GET /v1/achillea/clans/:tag` : Fiche détaillée d'un clan et composition du roster.
- `POST /v1/achillea/clans/:tag/invite` : Invitation d'un joueur par le chef de clan.
- `POST /v1/achillea/clans/:tag/join` : Demande d'adhésion d'un joueur.
- `DELETE /v1/achillea/clans/:tag/members/:userId` : Exclusion d'un membre.
- `GET /v1/achillea/organizations` : Liste des structures esport partenaires.
- `GET /v1/achillea/organizations/:id` : Détails de l'organisation et événements affiliés.

#### E. Ligues (`/v1/achillea/leagues`)
- `GET /v1/achillea/leagues` : Liste des ligues officielles.
- `GET /v1/achillea/leagues/:id/seasons` : Saisons et divisions d'une ligue.
- `GET /v1/achillea/leagues/:id/standings` : Classement par points, différence de buts, victoires/défaites.

#### F. Licences & Passeport Compétitif (`/v1/achillea/licenses`)
- `GET /v1/achillea/licenses/me` : Licence du joueur connecté (statut, validité, niveau certifié).
- `POST /v1/achillea/licenses/apply` : Demande de délivrance ou renouvellement d'une licence esport.
- `GET /v1/achillea/licenses/verify/:licenseId` : Vérification publique de la validité d'une licence.

#### G. Administration Staff & Modération (`/v1/achillea/admin`, `/v1/achillea/sanctions`, `/v1/achillea/player-notes`)
- `GET /v1/achillea/admin/dashboard` : Métriques globales de la plateforme (inscriptions, litiges ouverts).
- `GET /v1/achillea/admin/disputes` : Liste des litiges de match en attente d'arbitrage.
- `POST /v1/achillea/admin/disputes/:id/resolve` : Clôture arbitrale avec attribution des points.
- `GET /v1/achillea/sanctions` : Historique des sanctions disciplinaires.
- `POST /v1/achillea/sanctions` : Émission d'un avertissement, suspension temporaire ou ban.
- `GET /v1/achillea/player-notes/:userId` : Notes internes de modération sur un joueur (restreint Staff).
- `POST /v1/achillea/player-notes/:userId` : Ajout d'une observation de modération.

#### H. Économie, Portefeuille & Notifications (`/v1/achillea/wallet`, `/v1/achillea/notifications`, `/v1/achillea/guilds`)
- `GET /v1/achillea/wallet/balance` : Solde de monnaie virtuelle / récompenses de tournoi.
- `GET /v1/achillea/wallet/history` : Historique des gains, primes et débits.
- `GET /v1/achillea/notifications` : Boîte de réception des notifications utilisateur.
- `POST /v1/achillea/notifications/:id/read` : Marquage d'une notification comme lue.
- `GET /v1/achillea/guilds/config` : Configuration des canaux et rôles Discord liés aux tournois.

---

### 3.3. Surface Wiki & Données de Jeu Inazuma Eleven (`/v1/wiki/*`, `/v1/inagle/*`, `/v1/azalee/*`)

#### A. Données Principales du Wiki (`/v1/wiki/*`)
- `GET /v1/wiki/characters` : Recherche de personnages (filtres : nom romaji/localisé, élément, poste, genre, page, limit).
- `GET /v1/wiki/characters/:slug` : Fiche détaillée d'un joueur avec statistiques max, moveset et arbre de recrutement.
- `GET /v1/wiki/skills` : Recherche de techniques / hissatsu (filtres : élément, type shoot/dribble/block/catch, puissance).
- `GET /v1/wiki/skills/:id` : Détails d'une technique (coût PT/FP, taux d'évolution, description).
- `GET /v1/wiki/items` : Équipements, manuels, objets clés et uniformes.
- `GET /v1/wiki/items/:id` : Caractéristiques et bonus de statistiques d'un équipement.
- `GET /v1/wiki/quests` : Quêtes et défis de recrutement.
- `GET /v1/wiki/passives` : Talents passifs et effets en match.
- `GET /v1/wiki/teams` : Équipes canoniques et formations tactiques.
- `GET /v1/wiki/teams/:id` : Effectif complet d'une équipe avec schéma tactique.
- `GET /v1/wiki/drops` : Tables de butin par match et trésor.

#### B. Moteur Inagle SQL Pur (`/v1/inagle/*`)
- `GET /v1/inagle/health` : Statut du module Inagle.
- `GET /v1/inagle/teams` : Liste des équipes avec pagination et filtres SQL directs.
- `GET /v1/inagle/teams/:id` : Équipe individuelle résolue depuis `inagle_teams`.

#### C. Pont de Rétrocompatibilité Azalée Headless (`/v1/azalee/api/*`)
Ce pont remappe de manière transparente l'ancienne API headless Azalée (`:8807`) vers le moteur SQL Kysely unifié :
- `GET /v1/azalee/health` : Bilan de santé du bridge Azalée (`source: "unified"`).
- `GET /v1/azalee/api/cpk/search` : Recherche de fichiers dans les archives CPK.
- `GET /v1/azalee/api/cpk/file` : Extraction et métadonnées d'un fichier CPK.
- `GET /v1/azalee/api/text/stats` : Statistiques du corpus textuel du jeu.
- `GET /v1/azalee/api/text/:hash` : Résolution multilingue d'un identifiant textuel.
- `GET /v1/azalee/api/cross/catalog` : Catalogue croisé des correspondances d'assets.
- `GET /v1/azalee/api/cross/stats` : Statistiques de couverture du catalogue croisé.
- Tables auxiliaires : `/shops`, `/capsules`, `/costumes`, `/stadiums`, `/trophies`, `/invocation`, `/coordinators`, `/gallery`, `/auras`.

---

### 3.4. Surface Communauté, Contenu & Facturation

#### A. Communauté (`/v1/community/*`)
- `GET /v1/community/info` : Métriques globales de la communauté (membres, tournois hébergés, guides).
- `GET /v1/community/emotes` : Liste des émojis du serveur Discord principal Rose Griffon.
- `GET /v1/community/tags/popular` : Mots-clés et tags les plus recherchés.

#### B. Contenu & Actualités (`/v1/content/*`)
- `GET /v1/content/news/feed` : Flux des actualités, patch notes et annonces (pagination `page`, catégorie `category`, recherche `q`).
- `GET /v1/content/calendar-events` : Calendrier des événements et compétitions officielles.

#### C. Facturation (`/v1/billing/*`)
- `POST /v1/billing/webhooks/stripe` : Traitement des webhooks Stripe (abonnements et contributions).

---

### 3.5. Services Intégrés : CDN, Stockage & Temps Réel

#### A. Surface CDN Unifiée (`/upload`, `/images/*`, `/api/assets/*`, `/cdn/health`)
Remplace le démon legacy `rg-cdn:8801`.
- `GET /cdn/health` : Statut du service de distribution d'assets.
- `POST /upload` : Téléversement sécurisé de fichiers statiques (images, avatars, preuves de match).
- `GET /images/*` : Distribution d'images avec mise en cache HTTP optimisée (`Cache-Control: public, max-age=31536000, immutable`).
- `GET /api/assets/*` : Accès aux assets graphiques du jeu et du site.

#### B. Surface Supabase Storage Compatible (`/storage/v1/*`)
Remplace le démon legacy `rg-storage:8810`.
- Stockage persistant sur disque local `/var/www/rg-storage`.
- Endpoints compatibles avec le client Supabase JS standard :
  - `GET /storage/v1/bucket` : Liste des seaux (buckets) de stockage.
  - `GET /storage/v1/object/public/:bucket/*` : Téléchargement public direct d'un objet.
  - `POST /storage/v1/object/:bucket/*` : Écriture avec contrôle d'intégrité et validation du type MIME.

#### C. Surface Supabase Realtime SSE & WebSockets (`/realtime/v1/*`, `/v1/achillea/ws`)
Remplace le démon legacy `rg-realtime:8812` et le WebSocket legacy `:4005`.
- `GET /realtime/v1/*`, `GET /v1/realtime/v1/stream` : Flux d'événements serveur (Server-Sent Events) synchronisés sur les notifications PostgreSQL `LISTEN/NOTIFY`.
- `WS /v1/achillea/ws` : Hub WebSocket haute performance animé par **Colyseus** pour le temps réel compétitif :
  - Salon `QueueRoom` : Matchmaking interactif.
  - Salon `MatchRoom` : Suivi d'état, décompte de temps, score en direct.
  - Salon `LobbyRoom` : Salons personnalisés pour organisateurs de tournois.

---

## 4. Exemple d'Intégration Client (Eden Treaty)

L'intégration dans l'application frontend Next.js 16 ([`apps/rg/website`](../../../apps/rg/website)) est entièrement typesafe :

```typescript
import { treaty } from "@elysia/eden";
import type { App } from "@rosegriffon/bot/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://api.rosegriffon.fr";

export const client = treaty<App>(API_BASE_URL);

// Exemple de requête RSC fortement typée :
export async function getFeaturedTournaments() {
  const { data, error } = await client.v1.achillea.tournaments.get({
    query: { limit: 5, status: "open" }
  });

  if (error) throw new Error(error.value.message);
  return data.data;
}
```
