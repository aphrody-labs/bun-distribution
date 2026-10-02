# Achilléa → `apps/website` — plan de migration du front

Plan d'exécution pour absorber **`apps/achillea-web` (Angular 21 + PrimeNG)** dans
**`apps/website` (Next 16 + React 19 + `@rose-griffon/ui`)**, de sorte que
`rosegriffon.fr` devienne l'unique site du réseau : portail, wiki Azalée et
Achilléa compétitif.

> Statut : **migration applicative terminée le 21/9/2026**. Le rendu public est
> assuré par `apps/website` sous `/achillea`, les routes Angular sont couvertes
> par des tests de parité et `achillea.rosegriffon.fr` redirige vers Next. Le
> dossier Angular a été retiré, avec ses dépendances exclusives, après la
> validation de parité. Ce document conserve seulement le journal de migration.
> Il prolonge
> `docs/achillea-modulaire.md` (§ « Prochaine étape si l'on migre le front ») et
> ne redit pas ce qui y est déjà décrit. Contexte d'intégration :
> `docs/achillea.md`. Services et ports : `docs/achillea-services.md`.

---

## 0. Décisions tranchées (20/9/2026)

### 0.1 — Chemins d'URL en anglais

`/achillea/clans/create`, `/achillea/tournaments/[id]`, `/achillea/ranked/leaderboard`…
Le contrat de nommage du `CLAUDE.md` est explicite : **anglais pour tout ce que
la machine lit, URLs comprises**. Une première version de ce plan proposait des
chemins français (`/tournois`, `/creation`, `/portefeuille`) : c'était une
violation du contrat, elle est annulée. Bonus non négligeable : les chemins
Angular actuels deviennent des sous-chemins quasi identiques, donc les
redirections 301 sont triviales et le risque SEO s'effondre.

### 0.2 — Authentification : cookie élargi à `.rosegriffon.fr`, pas de pont de jetons

Fait constaté : `apps/achillea-bot/src/auth/session.ts` pose un cookie de session
`httpOnly`, `sameSite: "lax"`, **sans `domain`** — donc *host-only* sur l'hôte de
l'API. Conséquences réelles :

- Depuis un navigateur sur `rosegriffon.fr`, un `fetch(credentials: "include")`
  vers `api.rosegriffon.fr` **fonctionne** (même site au sens `SameSite`).
  L'`AchilleaAuthProvider` côté client est donc valide tel quel.
- Mais le **serveur Next ne verra jamais ce cookie** : le navigateur ne
  l'attache pas aux requêtes vers `rosegriffon.fr`. Sans correctif, toute page
  Achilléa authentifiée devient client-only, et la garde de rôle redescend côté
  navigateur — exactement ce que la phase 2 interdit.

**Décision** : ajouter `domain: ".rosegriffon.fr"` à `sessionCookieOptions()`.
Une ligne, réversible, aucun changement de contrat d'API, aucune migration de
données. Le serveur Next peut alors relayer le cookie entrant vers
`client.auth.me()` et résoudre la session **en RSC**, ce qui rend les gardes
serveur possibles.

Les deux options du plan initial sont écartées :
- *Pont de jetons* : demandait d'accepter un nouvel émetteur côté API, pour un
  résultat que l'élargissement de domaine obtient gratuitement.
- *Unification complète des comptes* : touche `achillea-bot` et sa base. Reste
  la cible long terme, hors de ce plan.

Contrepartie assumée : le cookie devient ambiant sur tous les sous-domaines RG.
Il reste `httpOnly` (illisible en JS) ; le risque ajouté est l'autorité ambiante
en cas de XSS sur un sous-domaine, tous first-party. `sameSite: "lax"` est
conservé. CORS : `Access-Control-Allow-Credentials` avec origine explicite,
jamais `*`.

### 0.3 — Un seul exécutant, un seul plan

Le portage est **exécuté par l'agent déjà en vol** (assets, `auth-context.tsx`,
`hero-bg-fx.ts`, 6 composants partagés sous `src/components/achillea/`). Ce
document est la référence d'architecture et de revue ; `docs/achillea-migration-plan.md`
est absorbé ici et supprimé — un seul plan, sinon les deux dérivent.

---

## 1. Ce qui existe déjà et ne doit PAS être recréé

C'est le point décisif : **les trois couches basses sont déjà portées, typées,
testées et branchées sur `apps/website`.** La migration n'est pas une
réécriture d'application, c'est le remplacement d'un adaptateur d'affichage.

| Brique existante | Emplacement | Ce qu'elle couvre déjà |
| --- | --- | --- |
| Contrat pur | `packages/achillea-types` | DTO, enums, domaine. Zéro dépendance. Regénère JSON Schema/Rust/Swift/Kotlin via `bun run achillea:contract`. |
| Métier multi-runtime | `packages/achillea-core` | 24 modules : `elo`, `ranking`, `brackets`, `tournaments`, `clans`, `casts`, `licenses`, `sanctions`, `wallet`, `access`, `format`, `labels`, `presentation`, `validation`… Interdit d'y toucher depuis le front. |
| Client HTTP isomorphe | `packages/achillea-client` | `AchilleaClient` + **16 ressources** (`admin`, `auth`, `casts`, `clans`, `guilds`, `leagues`, `licenses`, `notifications`, `organizations`, `playerNotes`, `ranked`, `sanctions`, `stats`, `tournaments`, `users`, `wallet`). Ne lève jamais : rend `{ ok, … }`. Fonctionne en RSC, en route handler et en îlot client. |
| Adaptateur Next | `apps/website/src/lib/achillea/` | `createAchilleaClient()`, `achilleaApiUrl()`, `tone.ts` (mapping tons → variantes de badge), ré-exports `core`/`types`. Tests : `apps/website/src/lib/achillea/achillea.test.ts`. |
| Dépendances déclarées | `apps/website/package.json` | `@rosegriffon/achillea-{client,core,types}` sont **déjà** en `workspace:*`. Rien à installer. |
| Route publique | `apps/website/src/app/api/public/achillea/info/route.ts` | Première consommation en production. |
| Entrée visuelle | `apps/website/src/components/home/AchilleaBanner.tsx` | Bloc Achilléa de la home unifiée. |
| Design system | `packages/ui` (58 composants MD3) | Remplace PrimeNG. Tokens FR : `succes`, `alerte`, `info` — jamais `success`/`warning`. |
| Chrome partagé | `packages/app-shell` | Navigation unique, source unique non paramétrée (`NavBases` a été retiré avec l'app azalee autonome). C'est là qu'on ajoute l'entrée Achilléa, **pas** dans `apps/*/config/navigation.ts`. |

**Corollaire** : les ~4 746 lignes de `apps/achillea-web/src/app/shared/services/**`
(16 services Angular) et les 35 modèles de `core/models/**` n'ont plus de logique
métier à sauver — ce sont des appels HTTP et de la mise en forme que `client` +
`core` couvrent déjà. Elles sont **supprimées**, pas portées.

### Inventaire à porter (le vrai périmètre)

`apps/achillea-web/src/app/views` + `shared/components` = **35 394 lignes**
(138 `.ts`, 78 `.html`, 62 `.css`), soit 29 vues et 30 composants partagés.

| Vue | LOC | Vue | LOC |
| --- | ---: | --- | ---: |
| `admin-dashboard` | 4961 | `clan-dashboard` | 305 |
| `tournament-page` | 3909 | `clans-list` | 297 |
| `asytral-league` | 2740 | `cast-planning` | 264 |
| `homepage` | 2284 | `ranked-tiers` | 238 |
| `tournament-ranking` | 1368 | `clan-profile` | 175 |
| `clan-creation` | 885 | `wallet` | 170 |
| `ranked-match` | 826 | `ranked-challenge` | 148 |
| `guide` | 804 | `licence` | 115 |
| `user-profile` | 681 | `licence-verify` | 99 |
| `ranked` | 542 | `cast-availability` | 95 |
| `ranked-leaderboard` | 469 | `organization-validation` | 91 |
| `ranked-history` | 353 | `auth-page` | 76 |
| | | `casts-public` + 4 vues triviales | < 60 chacune |

---

## 2. Cible : plan de routes

Préfixe `/achillea` dans `apps/website/src/app/achillea/**`, chemins **en
anglais** (§0.1). `achillea.rosegriffon.fr` redirige ensuite en **301** vers ces
chemins — même schéma que `azalee.rosegriffon.fr` → `/wiki`, déjà éprouvé.

| Angular (`app.routes.ts`) | Next (`app/achillea/…`) | Rendu | Garde | Ressources du client |
| --- | --- | --- | --- | --- |
| `""` | `page.tsx` | RSC + ISR | — | `tournaments.list`, `ranked.leaderboard` |
| `auth` | `auth/page.tsx` | client | — | `auth.discordLoginUrl` |
| `clans` | `clans/page.tsx` | RSC | — | `clans.list` |
| `clans/create` | `clans/create/page.tsx` | client | session | `clans.create` |
| `clans/dashboard` | `clans/dashboard/page.tsx` | client | rôle ≥ `SubCaptain` | `clans.update`, invitations, candidatures |
| `clans/:id` | `clans/[id]/page.tsx` | RSC | — | `clans.get`, `clans.members` |
| `users/:id` | `users/[id]/page.tsx` | RSC | — | `users.profile`, `ranked`, `stats` |
| `events/list/tournament` | `tournaments/page.tsx` | RSC | — | `tournaments.list` |
| `events/tournaments/:id` | `tournaments/[id]/page.tsx` | RSC + îlots | — | `tournaments.get`, bracket, participants |
| `events/create/tournament` | `tournaments/create/page.tsx` | client | session | `tournaments.create` |
| `events/tournaments/circuit/ranking` | `tournaments/circuit/ranking/page.tsx` | RSC | — | `stats`, `tournaments.circuit` |
| `leagues/astral` (+3 alias) | `leagues/astral/page.tsx` | RSC | — | `leagues.getSeason` |
| `organizations/create` | `organizations/create/page.tsx` | client | session | `organizations.create` |
| `ranked` | `ranked/page.tsx` | client | session | `ranked.profile`, `ranked.match` |
| `ranked/tiers` | `ranked/tiers/page.tsx` | statique | — | `ranked.tiers` |
| `ranked/leaderboard` | `ranked/leaderboard/page.tsx` | RSC + ISR 60 s | — | `ranked.leaderboard` |
| `ranked/history` | `ranked/history/page.tsx` | client | session | `ranked.history` |
| `ranked/match` | `ranked/match/page.tsx` | client (temps réel) | session | `ranked.match`, Colyseus |
| `ranked/defi/:code` | `ranked/defi/[code]/page.tsx` | client | — | `ranked.challenge` |
| `licence` | `licence/page.tsx` | client | session | `licenses.me` |
| `licence/verify/:qr` | `licence/verify/[qr]/page.tsx` | RSC | — | `licenses.verify` |
| `wallet` | `wallet/page.tsx` | client | session | `wallet.balance` |
| `casts` | `casts/page.tsx` | RSC | — | `casts.casters` |
| `casts/:tournamentId/availability` | `casts/[tournamentId]/availability/page.tsx` | client | session | `casts.submitAvailability` |
| `casts/:tournamentId/planning` | `casts/[tournamentId]/planning/page.tsx` | client | Administrator | `casts.planning` |
| `admins/dashboard` | `admins/dashboard/page.tsx` | client | Moderator+ | `admin.*` |
| `admins/sanctions` | `admins/sanctions/page.tsx` | client | Administrator | `sanctions.*` |
| `admins/ranked-disputes` | `admins/ranked-disputes/page.tsx` | client | Administrator | `admin.disputes` |
| `admins/dashboard/organizations/validate/:id` | `admins/dashboard/organizations/validate/[id]/page.tsx` | client | Administrator | `organizations.validate` |
| `guide`, `guide/brand` | `guide/page.tsx`, `guide/brand/page.tsx` | statique | — | — |
| `forbidden`, `not-found`, `**` | `forbidden/page.tsx`, `not-found.tsx` | statique | — | — |

Les alias `leagues/astral-s1`, `leagues/asytral`, `leagues/asytral-s1`
deviennent des `redirects()` permanents vers `leagues/astral`.

**Les anciennes URL doivent survivre.** Chaque chemin Angular ci-dessus reçoit
une redirection permanente dans `next.config` vers son équivalent préfixé
`/achillea`. Un tableau de correspondance non exhaustif = régression SEO.

## 3. Correspondance des mécanismes Angular → Next

| Angular | Cible Next | Note |
| --- | --- | --- |
| `loadComponent` + lazy route | segment `app/achillea/**` | découpage automatique |
| `canActivate: [authGuard]` | vérification de session en RSC + `redirect()` | plus de garde côté client seul |
| `canActivate: [userRoleGuard(x)]` | `access` de `@rosegriffon/achillea-core` | la règle existe déjà, ne pas la réécrire |
| `canActivate: [inClanGuard(role)]` / `clanGuard` | idem, via `clans` + `access` | idem |
| `AuthSessionService` (signals) | session `@rosegriffon/auth` + `getAuthToken` du client | voir §4 |
| 16 `*-service.ts` (RxJS/HttpClient) | `createAchilleaClient().<ressource>` | **supprimés** |
| `core/models/*.ts` (35) | `@rosegriffon/achillea-types` | **supprimés** |
| `api-base-url.interceptor.ts` | `baseUrl` du client | supprimé |
| PrimeNG (`p-table`, `p-dialog`, `p-select`…) | `packages/ui` (Table, Dialog, Select, Tabs…) | 1 pour 1 sur l'essentiel ; les manquants s'ajoutent à `packages/ui`, jamais en local |
| `brackets-viewer` | conservé, monté dans un îlot `"use client"` | lib DOM impérative, pas de portage |
| `ngx-translate` + `src/assets/i18n/fr.json` (202 clés) | provider de langue existant (`providers/language-provider.tsx`) | le fichier de clés est **repris tel quel** |
| `ngx-lottie` / `lottie-web` | `lottie-web` dans un îlot client | dépendance conservée |
| `socket.io-client` (notifications) | îlot client + hook `useNotifications` | dernier lot, cf. §5 phase 4 |
| `@colyseus/sdk` (`ranked-room-service`) | îlot client dédié `ranked/match` | idem — seul endroit où Angular n'est pas un simple adaptateur |
| `environment.ts` / `achillea-config.js` (runtime) | `NEXT_PUBLIC_ACHILLEA_API_URL` + variantes | ⚠️ `NEXT_PUBLIC_*` inliné au **build** : lancer `bun run deploy website` depuis `apps/website`, jamais depuis la racine |
| `@casl/ability` | `access` de `achillea-core` | à vérifier vue par vue ; si un cas manque, il va dans `core`, pas dans l'app |

---

## 4. Authentification — mise en œuvre de la décision §0.2

Deux systèmes cohabitent aujourd'hui.

- `apps/website` : `@rosegriffon/auth` (better-auth) + Supabase self-host,
  cookie de session sur `rosegriffon.fr`.
- Achilléa : session Discord propre, posée par
  `apps/achillea-bot/src/auth/session.ts` (`httpOnly`, `sameSite: "lax"`,
  host-only), plus un **jeton temps réel** distinct (`getRealtimeToken`, marge
  de renouvellement 30 s) pour Socket.IO et Colyseus — le cookie `httpOnly`
  n'étant pas exploitable en WSS cross-domaine.

Ils **restent séparés**. On ne fusionne pas les comptes ; on rend seulement la
session Achilléa lisible par le serveur Next.

**Mise en œuvre, dans l'ordre :**

1. `sessionCookieOptions()` → ajouter `domain: ".rosegriffon.fr"`. Les sessions
   déjà émises restent host-only jusqu'à expiration : prévoir la cohabitation
   des deux portées pendant un `SESSION_TTL`, et ne pas s'étonner d'un
   double-cookie transitoire.
2. CORS de l'API : autoriser `https://rosegriffon.fr` en origine **explicite**
   avec `Access-Control-Allow-Credentials: true`. Jamais `*` — la combinaison
   est refusée par le navigateur, et le serait à raison.
3. `apps/website/src/lib/achillea/session.ts` (serveur) : lit les cookies
   entrants, les relaie à `client.auth.me()`, mémoïse par requête. C'est la
   brique qui permet `redirect()` **avant** rendu sur les pages gardées.
4. Les gardes de rôle réutilisent `access` de `@rosegriffon/achillea-core` —
   la règle existe, on ne la réécrit pas.
5. `AchilleaAuthProvider` (déjà écrit) reste, mais devient un miroir hydraté
   depuis le serveur plutôt que la source de vérité : il ne doit plus être le
   seul à décider qui voit quoi.

`safeReturnUrl()` de `core/auth/auth-session.service.ts` est la seule fonction
de ce fichier à conserver — elle part dans `apps/website/src/lib/achillea/`.

**Invariant non négociable** : une garde côté client est un confort
d'affichage. Toute action sensible reste refusée côté API, comme aujourd'hui
(cf. le commentaire de `admins/dashboard` dans `app.routes.ts`).

---

## 5. Phases, chacune livrable et réversible

Ordre choisi pour que **rien ne casse à aucun moment** : `apps/achillea-web`
reste en production et servi par `achillea.rosegriffon.fr` jusqu'à la phase 5.
Les deux fronts coexistent sur la même API.

### Phase 0 — socle (sans écran)
- `apps/website/src/app/achillea/layout.tsx` : chrome Achilléa via `app-shell`,
  entrée de navigation ajoutée dans le registre unique de `packages/app-shell`
  (voir `BASE_ESPORT` dans `src/config/routes.ts`, `NavBases` a été retiré).
- Reprise de `src/assets/i18n/fr.json` et des assets `public/` d'Achilléa.
- Thème : vérifier que les 4 thèmes déclarent le même jeu de variables
  (`packages/ui/test/tokens.test.ts`) après ajout éventuel de tokens Achilléa.
- **Gate** : `type-check` + `build` + `bun test packages/ui packages/app-shell`.

### Phase 1 — écrans en lecture seule (≈ 6 200 LOC source)
`clans`, `clans/[id]`, `joueurs/[id]`, `tournois`, `tournois/[id]`,
`tournois/circuit/classement`, `ligues/astral`, `ranked/classement`,
`ranked/paliers`, `casts`, `guide`, `licence/verification/[qr]`, `forbidden`,
`not-found`.
Ne dépendent que de `client` + `core`, déjà branchés et testés. Server
Components, ISR court sur ce qui bouge (classements : 60 s).
- **Gate** : parité de données prouvée — un test qui compare, pour un même
  identifiant, la réponse de l'API et ce que la page rend (comptes, ordre,
  libellés) ; plus `bun run build` et les tests de liens
  (`packages/app-shell/test/liens.test.ts`, `sidebar-config.test.ts`) qui
  refuseront toute entrée de menu sans page.

### Phase 2 — authentification + écrans de session (≈ 3 000 LOC)
Élargissement du cookie + session serveur (§0.2 et §4), puis `ranked`, `ranked/historique`, `licence`,
`portefeuille`, `clans/creation`, `clans/tableau-de-bord`,
`organisations/creation`, `tournois/creation`,
`casts/[tournoi]/disponibilites`.
- **Gate** : chaque garde Angular a son équivalent testé (un utilisateur sans
  rôle est refusé côté **serveur**, pas seulement masqué côté client).

### Phase 3 — administration (≈ 5 400 LOC)
`admin`, `admin/sanctions`, `admin/litiges`, `admin/organisations/[id]`,
`casts/[tournoi]/planning`. Le plus gros bloc (`admin-dashboard` = 4 961 LOC à
lui seul) : à découper en sous-lots par onglet.
- **Gate** : les actions sensibles restent refusées côté API même si l'UI les
  expose (c'est déjà la règle dans `app.routes.ts`, elle ne doit pas se
  relâcher).

### Phase 4 — temps réel (≈ 1 000 LOC)
`ranked/match`, `ranked/defi/[code]`, notifications Socket.IO. Îlots
`"use client"` exclusivement. Jeton temps réel dédié, renouvellement conservé.
- **Gate** : un match ranked complet joué de bout en bout sur le nouveau front,
  avec reconnexion forcée en cours de route.

### Phase 5 — bascule et retrait
1. `achillea.rosegriffon.fr` → **301** vers `rosegriffon.fr/achillea/*`
   (`infra/nginx/achillea.rosegriffon.conf`), redirections de chemins en place.
2. Période d'observation avec les deux fronts encore déployables.
3. Retrait : `apps/achillea-web`, son entrée d'espace de travail, ses ~20
   dépendances exclusives (`@angular/*`, `primeng`, `@primeuix/themes`,
   `primeicons`, `primelocale`, `zone.js`, `ngx-*`, `karma*`, `jasmine*`,
   `@types/jasmine`, `puppeteer`, `tailwindcss-primeui`, `@angular/build`,
   `@angular/cli`), `angular.json`, ses `tsconfig.*`, sa CI.
4. `@colyseus/sdk`, `socket.io-client`, `brackets-viewer`, `brackets-model`,
   `lottie-web`, `iso-639-1`, `valibot`, `@sindresorhus/transliterate` **ne
   sont pas** des dépendances Angular : elles déménagent vers `apps/website`
   (ou `packages/ui`) au moment où la phase qui les consomme atterrit.

**Ce qui reste un adaptateur** : `apps/achillea-bot` conserve le gateway Discord,
les commandes, les embeds, les notifications et les contrôleurs de compatibilité.
Les règles métier portables sont progressivement extraites vers
`@rosegriffon/achillea-core` et les formes vers `@rosegriffon/achillea-types`;
les routes REST et l'accès DB restent provisoirement dans le bot tant qu'un
service plateforme équivalent n'est pas branché. L'API `:4000`/`:4002`, le
Socket.IO `:4005`, `ranked.rosegriffon.fr`, les services Supabase et les
migrations restent inchangés comme infrastructure d'exécution.

---

## 6. Garde-fous permanents (hérités du `CLAUDE.md`)

- **Couches** : un DTO ou une règle métier qui réapparaît dans
  `apps/website/src/app/achillea/**` est une régression. Destination :
  `achillea-types` (contrat pur) ou `achillea-core` (métier).
- Toute modification de `packages/achillea-types` impose
  `bun run achillea:contract` ; la CI lance `achillea:contract:check`.
- Un export lu côté serveur ne doit jamais venir d'un module `"use client"` :
  crash au `build`, pas au `type-check`. Toujours `bun run build`, pas
  seulement `bun --filter @rosegriffon/website type-check`.
- Tokens de couleur FR (`succes`/`alerte`/`info`), overlays `bg-scrim/xx`.
- Biome peut revert un `Edit` sur `*.tsx` : vérifier au `grep` après coup.
- `bun.lock` en `lockfileVersion 2` (Bun 1.4.0 en CI) — ne pas le rétrograder.
- Jamais de `rm -rf .next` sur une app servie par un service systemd.
- Déploiement : `bun run deploy website` (bleu/vert), un seul build à la fois.

## 7. Vérification à chaque phase

```bash
bun --filter @rosegriffon/website type-check
bun --filter @rosegriffon/achillea-types    type-check && bun --filter @rosegriffon/achillea-types    test
bun --filter @rosegriffon/achillea-core     type-check && bun --filter @rosegriffon/achillea-core     test
bun --filter @rosegriffon/achillea-client   type-check && bun --filter @rosegriffon/achillea-client   test
bun --filter @rosegriffon/achillea-contract check
bun test packages/app-shell/test packages/ui/test apps/website/src/lib/achillea
cd apps/website && bun run build
```

## 8. Risques, classés par coût d'une erreur

| Risque | Conséquence | Parade |
| --- | --- | --- |
| Cookie élargi à `.rosegriffon.fr` (§0.2) | Autorité ambiante sur tous les sous-domaines en cas de XSS | Cookie `httpOnly`, `sameSite: lax`, CORS à origine explicite ; élargissement réversible en une ligne |
| Gardes restées côté client | Une page admin rendue à qui n'y a pas droit | Session résolue en RSC (§4) ; l'API refuse de toute façon les actions sensibles |
| PrimeNG → `packages/ui` | 30 composants partagés à re-créer ; dérive visuelle | Combler les manques dans `packages/ui` (bénéficie aux 3 sites), jamais en local |
| URLs perdues | Régression SEO durable | Tableau de redirections exhaustif, vérifié par un test |
| `admin-dashboard` (4 961 LOC) | Lot ingérable | Découpage par onglet en phase 3 |
| Temps réel Colyseus/Socket.IO | Matchs ranked cassés | Dernier lot, front Angular encore déployable |
| `NEXT_PUBLIC_*` inliné | Front pointant sur la mauvaise API | Déployer depuis `apps/website` |

---

## 9. Annexe — détail fonctionnel par section

Absorbé de `docs/achillea-migration-plan.md` (supprimé). Ce que chaque écran doit
rendre, pour que « porté » veuille dire quelque chose de vérifiable.

- **Hub `/achillea`** — hero interactif (parallaxe + canvas de particules,
  `hero-bg-fx.ts`), tournoi à la une (compte à rebours, statut live, jauge de
  remplissage, avatars des participants), grille d'accès rapide (Clans, Ranked,
  Twitch, Discord), playlists vidéo.
- **Clans** — `ClanCard`, recherche et filtres niveau / recrutement / langue ;
  fiche clan avec bannière, statistiques, effectif, rôles, réseaux sociaux ;
  création (sélecteur de tag et de langues) ; tableau de bord (invitations,
  candidatures).
- **Ranked** — podium Top 3, table à pagination paresseuse, 11 paliers avec
  jauge de répartition (`TierDistribution`), file d'attente avec chrono
  dynamique et notifications, saisie de score et ouverture de litige.
- **Tournois & Astral League** — table de tournois avec tags de statut, page de
  tournoi (suivi des phases, `brackets-viewer`, participants), circuit
  (statistiques et records), page officielle Astral (classement, calendrier des
  journées, H2H, statistiques joueurs).
- **Services & compte** — carte de licence + vérificateur QR public, solde ACH
  et journal de transactions (`Intl.NumberFormat("fr-FR")` : NBSP étroit avant
  `€`, normaliser `/\s+/g` dans les tests), profil compétiteur (ELO × circuit),
  guide et brand kit.
- **Backoffice `/achillea/admins/dashboard`** — onglets : Vue d'ensemble,
  Arbitrage litiges, Saisons, Clans, Tournois, Bot, Télémétrie, Sanctions,
  Licences, Guildes. À porter onglet par onglet (§5, phase 3).

### Correction sur les redirections

Le plan absorbé plaçait les 301 (`/clans/:path*`, `/ranked/:path*`,
`/events/:path*`, `/wallet`, `/casts/:path*`, `/licence/:path*`,
`/leagues/:path*`) dans `next.config.ts`, à la **racine de `rosegriffon.fr`**.
C'est le mauvais endroit : ces chemins n'ont jamais existé sur `rosegriffon.fr`,
ils existaient sur `achillea.rosegriffon.fr`. Les déclarer à la racine ne
récupère aucun lien entrant et **gèle sept préfixes d'URL** que le portail ne
pourra plus utiliser (un futur `/wallet` côté boutique, par exemple).

Le bon endroit est le vhost `infra/nginx/achillea.rosegriffon.conf` :
`301 https://rosegriffon.fr/achillea$request_uri`. C'est exactement ce que fait
déjà `azalee.rosegriffon.fr` → `/wiki`.

---

## 10. Fusion des bases (miroir le 20/9/2026, fusion le même jour)

### Première étape : le miroir FDW, et sa limite

Le schéma `public` d'`achillea` a d'abord été exposé en LECTURE dans `rg`, sous
le schéma `achillea`, via `postgres_fdw` (`scripts/ops/achillea-fdw.ts`, retiré
depuis). La jointure marchait sans copier un octet, mais elle ne réglait que la
moitié du problème :

- 75 tables **étrangères** : lisibles, jamais écrivables, aucune contrainte ne
  pouvait franchir la frontière ;
- deux bases à sauvegarder, à migrer, à surveiller ;
- une tâche nocturne (`sync:achillea`) pour réaligner la FORME des tables après
  chaque migration d'Achilléa — un rattrapage permanent ;
- surtout : l'identité restait coupée en deux, un compte de chaque côté pour la
  même personne.

### Ce qui a été fait

`achillea` est désormais un **schéma de la base `rg`**, avec de vraies tables :
`scripts/ops/achillea-merge.ts` (`--verify`, `--copy`, `--copy-storage`,
`--cutover`).

- 69 tables, 67 politiques RLS reprises telles quelles, et les ACL d'origine —
  Achilléa suit le modèle Supabase, où `anon`/`authenticated` ont des droits
  larges et où la barrière réelle est la RLS.
- Les buckets `images` (381 objets) et `ranked-proofs` rejoignent le schéma
  `storage` commun. Les fichiers ne bougent pas : ils restent sous
  `/var/www/achillea-storage`, servis par `achillea-storage.service`.
- `achillea-bot`, `achillea-postgrest`, `achillea-storage` et
  `achillea-realtime` pointent sur `rg`. Le chemin de recherche est posé sur
  les RÔLES (`alter role … in database rg set search_path = achillea, public`),
  pas dans MikroORM : les 56 migrations écrivent des noms non qualifiés, et
  l'application n'a pas changé d'une ligne.
- `achillea-auth` (GoTrue dédié) est arrêté et désactivé : un seul utilisateur
  dans son schéma `auth`, aucun appel `/auth/v1/` dans les journaux nginx.
- La tâche `sync:achillea` et le rôle `achillea_reader` ont été supprimés.

La base `achillea` n'est PAS détruite : elle reste le repli immédiat.

### Ce que ça débloque, chiffré

| Mesure | Valeur |
| --- | ---: |
| Profils Rose Griffon | 1 812 |
| Utilisateurs Achilléa | 3 850 |
| **Comptes communs** (`profiles.discord_id` = `achillea."user".id`) | **538** |
| Clans | 69 |

Les 3 312 joueurs Achilléa sans profil RG sont la cible naturelle de la
passerelle d'inscription. `discord_id` est la seule clé commune : pas d'e-mail
partagé, pas d'identifiant interne unifié.

### Une seule session

`POST /api/achillea/session` échange la session Rose Griffon contre le jeton
qu'attend l'API Achilléa : il retrouve le compte Discord lié
(`account.provider_id = 'discord'`), garantit l'existence du joueur dans
`achillea."user"` — même base, donc une seule requête — et signe le JWT avec le
secret partagé (`ACHILLEA_JWT_SECRET`, identique à `JWT_SECRET_KEY` du bot).
Le contrat est centralisé dans `@rosegriffon/achillea-core` et la signature
serveur dans `@rosegriffon/auth/achillea-session`; ses tests vérifient le format
attendu par le vérificateur réel du bot.

`AchilleaAuthProvider` ne décide donc plus rien, et `AchilleaNav` n'a plus de
bouton « Connexion » : il y avait deux connexions et deux déconnexions dans le
même chrome, pour le même compte Discord. Un membre sans Discord lié reçoit un
`409` — pas de compte e-sport fantôme.

### Deux incidents corrigés au passage

1. **`stats:achillea` mesurait le vide.** La tâche tirait par SSH le journal
   nginx du second VPS, alors qu'Achilléa a été rapatrié sur le serveur
   principal : `achillea.rosegriffon.fr` et `ranked.rosegriffon.fr` sont servis
   ici et leurs lignes sont dans le journal **local**. Le SSH réussissait —
   il lisait un serveur où ces domaines n'existent plus — donc rien ne levait,
   et `/var/lib/rg/achillea-audience.json` contenait `"domaines": []` depuis le
   rapatriement. Corrigé : lecture locale, 392 requêtes remontées au premier
   passage.

2. **`rg-cron.service` était en boucle de redémarrage.** `nie-cron.service`
   (dépôt `niers`) est un fork du même démon : mêmes ports par défaut **3005**
   (HTTP), **3006** (annonces) et **4001** (IPC). La seconde unité à démarrer
   perdait, et c'était `rg-cron` — donc **aucune tâche planifiée de Rose
   Griffon ne tournait**. 3005 appartient à RG (`wg-forward@3005.service`,
   page d'administration). Corrigé : les trois ports de `niers` sont devenus
   configurables, et un drop-in `nie-cron.service.d/port.conf` les fixe à
   3015 / 3016 / 4011. Les deux démons tournent désormais ensemble.

### Reste à faire

- **Assets** : le doublon de 575 fichiers (**74 Mo**) entre `azalee` et
  `website` a disparu avec le retrait complet de l'app `apps/azalee`
  (`d74cee35`) ; `azalee.rosegriffon.fr` reste une redirection **301** vers
  `rosegriffon.fr/wiki`, sans app ni `public/` propre. `packages/assets`
  (`@rosegriffon/assets`, export `./public/*`) reste la destination des assets
  réellement partagés.
- **Pages d'administration** : la couche de données croisée existe
  (`admin-db.ts`) ; les 14 onglets du backoffice Achilléa restent à fusionner
  dans `/admin` (phase 3 du §5).
