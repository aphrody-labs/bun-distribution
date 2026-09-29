# Standard DB Achilléa/Rose Griffon

## Décision

La base canonique est PostgreSQL `rg`. Achilléa possède le schéma `achillea`
dans cette base ; `public`, `auth` et `storage` restent les schémas transverses
RG. La migration SQL `apps/website/sql/migrations/20260921_achillea_schema_standard.sql`
est idempotente et ne copie ni ne supprime de données.

Le standard d’accès serveur devient **Kysely + `pg` + migrations SQL** :

- transactions et verrous sont explicites ;
- `search_path=achillea,public` est imposé à chaque pool ;
- les migrations sont lisibles par Supabase/Postgres et indépendantes d’un ORM ;
- `@rosegriffon/db/achillea-sql` est la frontière commune pour le bot, les jobs
  et les futurs services plateforme.

Supabase/PostgREST reste l’accès web/RLS (`@rosegriffon/db`), tandis que Kysely
sert les opérations serveur transactionnelles. Drizzle n’est pas choisi pour
PostgreSQL Achilléa car son usage actuel dans le dépôt est limité à SQLite.

## Transition sans perte

1. Geler les nouvelles migrations MikroORM ; ne plus utiliser `schema:update`.
2. Appliquer la migration SQL de schéma sur `rg`, puis vérifier les rôles et le
   `search_path` avec `scripts/ops/achillea-merge.ts --verify`.
3. Migrer service par service vers `createAchilleaSql()` (lecture puis écriture),
   avec tests de parité sur les contrats `@rosegriffon/achillea-types`.
4. Quand le dernier service est migré, archiver les 56 migrations MikroORM dans
   un manifeste immuable et retirer les dépendances MikroORM de l’application.

Aucune commande de copie, de `DROP SCHEMA` ou de cutover n’est exécutée par le
build : ces opérations restent explicitement bornées au script d’exploitation
avec inventaire et sauvegarde.

## État de la conversion du bot

Les premiers services métier utilisent déjà cette frontière :

- `WalletService` : transactions, verrous de portefeuille et historique en
  Kysely, sans entités MikroORM ;
- `LeaderboardService` : classement et `DENSE_RANK` en requêtes Kysely
  paramétrées.
- `PlayerCardService` : lecture utilisateur/Elo en jointure Kysely typée ; le
  rendu PNG reste dans le bot car il dépend du runtime Discord/canvas.
- `RankedPromotionService` : lecture des paliers, Elo et identités en Kysely ;
  seules la planification et l’annonce Discord restent dans le bot.
- `LeaderboardAnnounceService` : saison, paliers et identités lus via Kysely ;
  la publication/édition du message reste Discord-only.
- `AnnouncementService` : guildes et journal des annonces en Kysely ; les
  envois, boutons et éditions Discord restent dans le bot.
- `RankedQueuePanelService` : statistiques et derniers résultats lus en Kysely ;
  le panneau et ses interactions restent Discord-only.
- `OAuthService` : le bot ne fait plus que présenter les boutons Discord et
  déléguer le démarrage à `/v1/auth/oauth/:provider/start`. L’API unifiée crée
  l’état CSRF et le callback `/v1/auth/oauth/callback` est son unique propriétaire.

Le callback Twitch/Challonge consomme également cet état CSRF via Kysely ; la
session Discord reste exclusivement détenue par Better Auth côté plateforme.

`AuditLogService` écrit et vérifie désormais la chaîne d’audit en Kysely ; seul
le miroir optionnel vers un salon Discord reste dans le bot. Le subscriber
MikroORM historique est conservé temporairement pour les écritures d’entités
dans leur transaction d’origine. Les écritures manuelles de la chaîne sont
elles-mêmes atomiques (lecture de la tête + insertion dans une transaction).

`ClanPosterService` lit désormais le clan, ses membres et leurs Elo via une
jointure Kysely typée ; seul le rendu Canvas et le stockage local de l’image
restent dans le bot.

`TournamentScheduleService` sélectionne les transitions dues directement dans
PostgreSQL/Kysely ; le cron déclenche ensuite les commandes de tournoi par
identifiant, sans charger d’entités ORM.

`TournamentEventService` écrit et lit le journal métier des tournois en Kysely
avec jointures utilisateur ; il ne dépend plus de MikroORM ni de Discord.

`RulesetService` lit et clone les règles via Kysely ; la validation pure reste
dans `@rosegriffon/achillea-core`.

`LicenseService` persiste, révoque et vérifie les licences en Kysely ; le PDF et
le QR code restent les seules responsabilités de rendu locales au bot.

`TwitchService` lit les connexions externes via Kysely ; les appels Twitch et
le cache de jeton restent des responsabilités d’intégration du bot.

`Suggestions` exécute la recherche fuzzy joueurs/clans via Kysely et la vue
`user_view`; son fallback `ILIKE` ne réintroduit pas l’ORM.

`PlayerNoteService` gère les notes staff (`player_note`) via Kysely et retourne
des enregistrements sérialisables ; seule la synchronisation Google Drive reste
un adaptateur local non bloquant.

Le module API unifié expose désormais aussi les organisations via
`/v1/achillea/organizations`, avec propriétaires et managers agrégés par
PostgreSQL ; la route est couverte par le contrat Eden.

Le classement public est également servi par `/v1/achillea/leaderboard` :
`DENSE_RANK`, pagination et sélection de saison sont calculés côté PostgreSQL,
sans passer par le service ORM du bot.

Les routes versionnées `/v1/achillea/leagues/*` et
`/v1/achillea/users/leaderboard` sont maintenant propriétaires de l'API unifiée
et s'appuient sur `@rosegriffon/achillea-core`/Kysely. Les anciennes routes
Ts.ED ne font plus que compatibilité HTTP vers cette source canonique.

La vérification QR des licences (`/v1/achillea/licenses/verify/:qrSecret`) est
également centralisée dans l'API ; le bot ne conserve que l'émission PDF/QR et
la présentation Discord en attendant le déplacement du générateur binaire.

`EloService.applyMatchResult` utilise désormais une transaction Kysely avec
verrouillage des lignes ELO et création idempotente ; les traitements de lobby
et de podium restent isolés dans la tranche ORM suivante.

`KyselyBracketAdapter` remplace également l’ancien adaptateur `em.execute` pour
les tables techniques `bm_*` de brackets-manager ; les identifiants dynamiques
sont validés et les valeurs restent paramétrées.

`OrganizationService` partage cette frontière Kysely pour les listes, états,
créations et managers ; la seule dépendance conservée dans le bot est la
notification Discord de nouvelle soumission.

Les autres services restent temporairement derrière l’adaptateur MikroORM afin
de permettre une conversion incrémentale sans interruption. Aucun nouveau
service ne doit ajouter de migration ou de logique métier dans MikroORM.
