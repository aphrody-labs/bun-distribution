# Achillea — journal historique d'intégration

Ce document conserve l'audit et les propositions de l'intégration historique
d'Achillea. **Il ne décrit plus l'architecture ni les routes courantes.** Depuis
le 21/9/2026, le site compétitif est intégré dans `apps/rg/website` (Next.js) sous
`https://rosegriffon.fr/achillea`; le dossier Angular autonome a été retiré.
Consulter [`achillea-migration-next.md`](../../plans/rg/achillea-migration-next.md) pour
l'architecture et les routes applicatives actuelles, et
[`achillea-services.md`](../../architecture/rg/achillea-services.md) pour les services/API.

Le sous-domaine `https://achillea.rosegriffon.fr/` redirige vers
`https://rosegriffon.fr/achillea` (vérifié le 24/9/2026). Une vérification HTTP
live le même jour a renvoyé `200` pour l'accueil et les routes statiques de
Ranked, tournois, clans, casts, licence, portefeuille, guide, ligues,
organisations et administration. Ces réponses prouvent que Next sert les URLs,
pas le fonctionnement des actions authentifiées côté navigateur.

> Statut historique : la première passerelle réelle est en service depuis le 14/8/2026 — voir
> la section ci-dessous. Le code du commit source audité est désormais importé dans les workspaces
> dédiés de ce dépôt ; la passerelle décrite dans cet audit historique n'avait pas été basculée.
> **Décision de cadrage (7/9/2026)** : préparer l'intégration dans l'arbre RG par des chemins
> dédiés (`apps/rg/website`, `apps/achillea-bot` (not in repo), `packages/rg/achillea-core` et
> `packages/rg/achillea-types`), avec un client partagé éventuel séparé, sans copier Achillea
> dans `apps/rg/bot`. Le VPS, la base Supabase, les secrets, les migrations et les services de
> production Achillea restent séparables tant que les phases de portage et leurs gates ne sont
> pas validées.
> **État opérationnel vérifié le 7/9/2026** : `migration.md` (clone jetable, hors de ce dépôt)
> décrit une bascule vers un VPS neuf ; l'IP cible n'est pas encore fixée. La gateway
> `/achillea/` vise donc `ranked.rosegriffon.fr` et jamais une IP. Le DNS, les certificats et
> la bascule de production restent du ressort d'Achillea ; ce plan ne les déclenche pas.
> **Audit monorepo du 7/9/2026** : inventaire Git/`rg` de l'arbre RG et lecture du dépôt
> Achillea `main` au commit `674b6897d49241f811eaa0254975bc3587e85b7f` (18:39 CEST), avec
> vérification des manifests, alias TypeScript, routes, migrations, variables, CI, Nginx,
> systemd, scripts de déploiement et surfaces cross-site. Les métriques du §8 sont un
> instantané de cet audit ; elles ne valent pas une sonde de production.
> **Périmé depuis (20/9/2026)** : l'app Next `apps/azalee` (not in repo) mentionnée dans les §5/§8
> ci-dessous a été fusionnée dans `apps/rg/website` (`c8713476`) puis entièrement supprimée
> (`d74cee35`) — toute mention d'`apps/azalee` (not in repo) ci-dessous est un instantané antérieur à
> cette fusion, pas l'état actuel. La fusion des bases Achilléa/RG et la session unique sont
> décrites dans `docs/plans/rg/achillea-migration-next.md` §10.

## Passerelle en service — guildes, rôles et salons (14/8/2026)

Le bot Achillea expose `GET /guilds`, `/guilds/stats` et `/guilds/:id` (métadonnées d'un
serveur Discord **avec** ses rôles et ses salons). Le monorepo RG les consomme désormais.

**Deux choses étaient cassées, et ne le sont plus.** Le contrôleur `/guilds` se disait,
en commentaire, alimenté par `scripts/ops/discord/scan-guilds.ts --db` — un script qui
n'existait pas : `guild_role` et `guild_channel` étaient vides, les 76 lignes de `guild`
avaient toutes leurs colonnes de scan à `NULL`, et l'API répondait `{"data":[],"total":0}`.
Le script a été écrit côté Achillea et branché sur son refresh nocturne ; le premier
passage a relevé **102 rôles et 113 salons** pour le serveur Achillea. Et un serveur jamais
scanné répond `200` avec des champs nuls : la commande le **dit** au lieu d'afficher une
fiche vide qui ressemblerait à un serveur désert.

**Côté RG, en deux couches.** `apps/rg/bot/src/services/achillea.ts` porte le transport et
des schémas **Zod** — aucun type TypeScript ne traverse la frontière entre les deux
dépôts, donc un `fetch` nu rendrait `any` et une colonne renommée là-bas s'afficherait
ici en `undefined` des mois plus tard. Les schémas produisent les types **et** vérifient
la réponse à l'exécution : une dérive devient une erreur nommée, avec le champ fautif.
`apps/rg/bot/src/lib/achillea-format.ts` porte la mise en forme (types de salons, groupement
par catégorie, découpage au budget de 1 024 caractères d'un champ d'embed), testée sans
Discord.

Commandes : `/achillea serveur`, `/achillea roles`, `/achillea salons`, `/achillea scan`.

L'adresse de l'API est configurable par `ACHILLEA_API_URL`. **Correctif (7/9/2026)** : le
défaut pointait jusqu'ici sur la boucle locale (`http://127.0.0.1:4000`), sur l'hypothèse
erronée que les deux bots partagent une machine. Faux — le dépôt `achillea` confirme (commit
`c64001e5`, 27/8/2026) l'hôte de production `51.255.162.6`, et prépare aujourd'hui son
transfert vers un **nouveau VPS dédié**, encore différent (`migration.md`) : Achillea garde
une infra propre et ne converge pas vers celle de RG. Le défaut a été corrigé vers l'entrée
publique stable `https://ranked.rosegriffon.fr/api`, indépendante de l'IP du VPS derrière.

## 0. Dernière campagne live connue (2026-06-04 — à revalider)

> Cette campagne est historique et n'a pas été rejouée pendant l'audit du 7/9/2026. Elle
> documente les derniers résultats connus, pas un état courant garanti.

| Endpoint | Résultat | Note |
| --- | --- | --- |
| `https://rosegriffon.fr/` | **200** HTML | Next.js SSR (lang fr) |
| `https://azalee.rosegriffon.fr/` | **200** HTML | Next.js SSR (dark) |
| `https://api.rosegriffon.fr/health` | **200** `{"status":"ok"}` | stub |
| `https://api.rosegriffon.fr/` (autre route) | **404** `{"error":"unknown service"}` | **rien d'autre que /health** |
| `https://ranked.rosegriffon.fr/api/health` | **200** | backend Achillea (bot) |
| `…/api/tournaments?page=1` | **200** (données réelles) | lecture OK |
| `…/api/clans?page=1` | **200** (vide en local) | lecture OK |
| `…/api/auth/me` · `…/api/ranked/me` | **401** | auth-gated (attendu) |
| `https://cdn.rosegriffon.fr/` | **404** | pas de listing |
| `cdn.rosegriffon.fr/images/<hash invalide>` | **403** | validation content-addressed |
| `https://achillea.rosegriffon.fr/` | **200** | front Achillea (nginx, VPS `51.255.162.6`) |

> ⚠️ **Images legacy mortes** : d'anciennes lignes `image` (ancienne prod Achillea) pointent sur
> `https://api.alessf.fr/images/<id>` qui **ne répond plus (000)**. Les uploads actuels utilisent
> le Storage Supabase Achillea ; `IMAGE_SERVER_URL` reste un ancien chemin optionnel. Les URLs
> legacy doivent être inventoriées avant toute réécriture vers le CDN RG.

## 1. Écosystème — les 3 sites

| Site | Domaine | Stack | Rôle |
| --- | --- | --- | --- |
| **website** | `rosegriffon.fr` | Next.js 16 (`apps/rg/website`) | site principal RG et wiki Azalée sous `/wiki` |
| **azalee** | `azalee.rosegriffon.fr` | redirection HTTP permanente | compatibilité vers `rosegriffon.fr/wiki`, aucun build autonome |
| **Achilléa** | `rosegriffon.fr/achillea` | Next.js (`apps/rg/website`) | espace compétitif : clans, tournois, ranked, casts |
| Alias historique | `achillea.rosegriffon.fr` | redirection permanente vers `/achillea` | compatibilité de l'ancien domaine |

Infra partagée : `api.rosegriffon.fr` (stub nginx, `/health`), `cdn.rosegriffon.fr` (service CDN d'images
`cdn.service`), backend Achillea sur `ranked.rosegriffon.fr` (bot Bun :4002/:4000).

## 2. API distante Achillea sur `api.rosegriffon.fr`

Aujourd'hui l'API Achillea est exposée sur **`ranked.rosegriffon.fr/api/*`** (consommée par le front via
les rewrites de son nginx). `api.rosegriffon.fr` n'est qu'un **stub** (`/health`, vérifié). Objectif : en faire la
**passerelle API unifiée** de l'écosystème, avec un préfixe par produit.

### Proposition — écrite dans le repo, pas encore activée sur le VPS
- `api.rosegriffon.fr/achillea/*` → proxy vers `https://ranked.rosegriffon.fr/api/` (pas de `127.0.0.1:4002` :
  le bot Achillea vit sur son propre VPS, cf. la décision du 7/9/2026 ci-dessus — l'IP change avec leur
  migration, `ranked.rosegriffon.fr` non).
- Conserver `ranked.rosegriffon.fr` (WSS Colyseus + REST actuel) pour compat ; `api.rosegriffon.fr/achillea`
  devient l'alias canonique « API publique ».
- Bloc `location /achillea/` déjà écrit dans `infra/nginx/api.rosegriffon.conf`. Activation : `sudo cp` +
  `nginx -t` + `reload` (cf. en-tête du fichier) — pas fait automatiquement par un déploiement d'app.

### Points d'attention
- **CORS** : ajouter `https://api.rosegriffon.fr` aux `WEB_ALLOWED_ORIGINS` du bot (`apps/rg/bot/.env`).
- **OAuth Discord** : l'authentification est possédée exclusivement par Better Auth sur
  `https://rosegriffon.fr/api/auth/callback/discord`. L'API Achillea ne fait plus d'échange de code Discord ;
  `/auth/discord` et les anciens callbacks ne sont que des redirections de compatibilité vers la page de connexion.
  Ne déclarer aucun callback OAuth Discord sur `api.rosegriffon.fr`.
- **Endpoints vérifiés** : `/tournaments`, `/clans` → 200 ; `/auth/me`, `/ranked/me` → 401 (auth). Autres servis
  par le bot : `/users/*`, `/notifications/*`, `/casts/*`, `/sanctions/*`, `/organizations/*`, `/admin/lobbies/*`
  (toutes les routes ne sont pas publiques ; certaines `/misc/*` renvoient 404 selon le sous-chemin).
- **Versionnage** : préfixer `/achillea/v1/` pour figer le contrat si l'API devient publique.

## 3. Assets et stockage Achillea

Le code actuel ne doit pas être décrit comme un producteur du CDN RG :

- `ProxyUploadController` et `CustomImagesUpload` utilisent `SupabaseImageStorage`, dans le
  bucket public du projet Supabase **Achillea** ; les URLs renvoyées sont celles du Storage
  Supabase, pas `cdn.rosegriffon.fr` ;
- les preuves de litige ranked suivent le même projet Supabase (avec repli disque si le Storage
  est indisponible) ;
- `PlayerCardService` et `ClanPosterService` rendent les PNG à la volée ; leurs méthodes de
  sauvegarde écrivent dans `storage/cards` et `storage/clans` sur le runtime Achillea ;
- `IMAGE_SERVER_URL`/`IMAGE_SERVER_API_KEY` restent des variables optionnelles héritées, et la
  documentation source indique que l'ancien CDN externe n'est plus une dépendance fiable.

**À faire, dans cet ordre** :

1. Inventorier les assets statiques du front (`apps/web/public/` (not in repo) : rangs, drapeaux, polices,
   animations, branding) et choisir pour chacun : bundle Angular, `packages/rg/assets` RG ou CDN.
2. Inventorier les URLs legacy (`api.alessf.fr` et autres) dans les données Achillea ; aucune
   réécriture massive ne doit viser la base RG ou le CDN partagé sans validation de propriété,
   droits d'accès, cache et présence de PII.
3. Garder les uploads utilisateurs, preuves et images générées liées aux données Achillea dans
   le stockage Achillea, ou définir un nouveau contrat de stockage dédié avant migration.

### Front Angular

Pointer le front vers le CDN RG uniquement pour les assets effectivement publiés sur ce CDN,
avec `<link rel="preconnect" href="https://cdn.rosegriffon.fr">`. Le préconnect
`__RANKED_ORIGIN__` couvre séparément `ranked.` ; aucun de ces préconnects ne change le
propriétaire des données.

### Bénéfice attendu

Un pipeline CDN peut réduire la charge du VPS pour les assets publics statiques, mais il ne doit
pas transformer le CDN RG en dépôt d'uploads ou de preuves Achillea sans modèle de sécurité,
rétention et suppression documenté.

## 4. SEO Achillea — calqué sur le monorepo RG

Achillea est une **SPA Angular (CSR, pas de SSR)** → handicap SEO majeur (HTML quasi vide au crawl).
Aligner sur l'approche `docs/la stratégie SEO du dépôt` (website + azalee, **vérifié** : `generateMetadata`,
`StructuredData` JSON-LD, `sitemap.ts` dans les deux apps) :

| Levier | website / azalee (réf.) | Achillea (à faire) |
| --- | --- | --- |
| Rendu | SSR/SSG Next.js | **Prerender Angular** (`@angular/ssr`) sur les routes publiques (`/clans/:id`, `/tournaments/:id`, `/chara/...`) |
| `<title>` / meta | `generateMetadata` par page | service `Title`/`Meta` Angular + `@angular/ssr` ; titres uniques par entité |
| Open Graph / Twitter | oui | balises OG/Twitter par route (image via CDN) |
| Données structurées | JSON-LD (`StructuredData`) | JSON-LD `BreadcrumbList`, `Organization`, `SportsTeam`/`Event` pour clans/tournois |
| Canonical | oui | `<link rel="canonical">` par route |
| `sitemap.xml` | `app/sitemap.ts` | sitemap dynamique (routes + entités) — **absent** côté Achillea (vérifié) |
| `robots.txt` | oui | ✅ déjà présent (statique) |

> **Priorité** : sans prerender, Google n'indexe que l'index. `@angular/ssr` (prerender des pages entité)
> = gain SEO #1, puis sitemap + JSON-LD + OG. Réutiliser les conventions titres/OG de `la stratégie SEO du dépôt`.

## 5. Intégration cross-site (home des 3 sites) — largement fait, vérifié (7/9/2026)

Le maillage existe déjà des deux côtés, pas seulement en projet :
- **website** (`apps/rg/website/src/app/page.tsx`) : bannières `AzaleeBanner` + `AchilleaBanner` sur la home,
  et le footer (`components/layout/footer.tsx`, colonne « L'association ») liste `azalee.rosegriffon.fr` +
  `achillea.rosegriffon.fr`.
- **azalee** (`apps/azalee/app/page.tsx` (not in repo) → `NetworkSection`) : bannières `RgtvBanner` (→ rosegriffon.fr) +
  `AchilleaBanner` sur la home. Le footer (`components/layout/Footer.tsx`) n'avait que les réseaux sociaux,
  pas de lien texte vers `rosegriffon.fr`/`achillea.rosegriffon.fr` — ajouté en colonne « L'association »
  pour égaler le pattern website.
- **achillea** : logos `rg-logo.png` + `azalee-logo.png` déjà embarqués côté front (cross-branding amorcé,
  cf. §7 historique) ; liens de retour non vérifiés depuis ce dépôt (code dans `rose-griffon/achillea`).

**Reste (dette, pas absence)** : `AchilleaBanner` existe en **deux copies divergentes** (`apps/rg/website` et
`apps/azalee/components/home` (not in repo)) — layouts différents (mobile dédié côté azalee), pas un simple doublon
copier-coller, donc pas mutualisé dans `packages/ui` en un composant unique sans un vrai design commun
préalable. Pas de `RG_SITES`/`EcosystemNav` partagé : chaque app définit ses props en dur dans son propre
composant de bannière.

### SEO du maillage
- Liens réciproques crawlables entre website ↔ azalee (vérifié). Achillea → à vérifier côté de son repo.
- `Organization` JSON-LD avec `sameAs` listant les 3 domaines : à vérifier (non audité ici).
- Domaine `achillea.rosegriffon.fr` en place (200, nginx) — le sous-domaine RG consolide le SEO.

## 6. Cron & types (écosystème)

- **Cron RG** = `rg-cron.service` → `bun run src/index.ts` dans `packages/rg/cron` (tâches `tasks/` +
  `check_team_members.ts` ; schedules `*/15`, `*/30`, `0 2`, `45 2`, `0 3`, `0 4`). Route vers
  `azalee.rosegriffon.fr` / `rosegriffon.fr`. **Ne touche pas Achillea.**
- **Cron Achillea** = interne au bot (décorateur `@Schedule` maison basé sur `cron` + tsyringe :
  backup DB, rappels casts, transitions de phases…). Séparé du cron RG.
- **Types** : deux paquets de contrats distincts, sans recouvrement —
  `@rosegriffon/types` (`article`, `stream`, `team`, `stats`, `user`, `roles`, `event`…) côté RG ;
  `@rosegriffon/achillea-types` (enums `clanState`, `clanMemberRole`, `userRole`, `eventEnums`) côté Achillea.
  Pour qu'un site RG consomme l'API Achillea de façon typée, publier/partager un sous-ensemble de contrat
  (DTO `clans`/`tournaments`) — sinon typage manuel côté consommateur.

## 7. Roadmap proposée

1. **Cross-site** (rapide, fort impact marque/SEO) : `RG_SITES` dans `packages/ui` + `EcosystemNav`/footer
   sur website & azalee + liens home.
2. **CDN** : migrer, après inventaire, les **assets statiques publics du front** Achillea vers
   `cdn.rosegriffon.fr` ; les uploads, preuves et images liées aux données restent dans le
   Storage Achillea tant qu'un contrat de stockage dédié n'est pas validé.
3. **API gateway** : `location /achillea/` sur `api.rosegriffon.fr` (lecture d'abord ; auth ensuite).
4. **SEO Achillea** : `@angular/ssr` prerender + sitemap + JSON-LD/OG ; domaine `achillea.rosegriffon.fr`.

## 8. Plan directeur d'intégration dans le monorepo RG

> **Base vérifiée** : dépôt `rose-griffon/achillea`, branche `main`, commit
> `674b6897d49241f811eaa0254975bc3587e85b7f` du 7/9/2026, comparé à l'arbre RG
> présent dans ce dépôt. L'ancien commit `532f4bfe...` du plan historique n'est plus
> une base fiable.
>
> **Méthode** : inventaire de tous les fichiers suivis des deux arbres, puis lecture des
> manifests, configs TypeScript/Angular, contrôleurs et guards, entités/migrations, tests,
> CI, Docker, Nginx, systemd, scripts de déploiement, clients RG et surfaces cross-site.
> Les métriques ci-dessous sont des repères de l'audit, pas des promesses de production.
>
> **Limite d'autorité** : ce plan organise le portage et les contrats ; il n'autorise ni
> migration de données, ni copie de secrets, ni bascule DNS, ni redémarrage de service,
> ni déploiement de production.

### 8.1 Inventaire réel du dépôt source

| Surface | État au commit audité | Destination de portage |
| --- | --- | --- |
| Backend | `apps/rg/bot/src` : 383 fichiers, 55 services, 60 fichiers d'entités, 25 contrôleurs et 181 handlers REST déclarés | `apps/achillea-bot` (not in repo) ; conserver le nom de package `achillea-bot` au premier portage |
| Ranked / temps réel | Sous-processus Colyseus dans `packages/rg/achillea-core/src/ranked`, plus Socket.IO séparé | inclus dans `apps/achillea-bot` (not in repo), sans le mélanger au bot RG |
| Frontend | `apps/web/src` (not in repo) : 295 fichiers, 37 entrées de routes Angular, SPA Angular 21 + PrimeNG 21 | migration terminée vers `apps/rg/website` ; le frontend Angular est retiré |
| Cœur métier | `packages/core/src` (not in repo) : 21 fichiers, logique ELO, ranking, sanctions, licences, votes, ligues et tournois | `packages/rg/achillea-core` ; première surface réutilisable |
| Contrats | `packages/rg/types/src` : 5 fichiers, enums et DTO métier | `packages/rg/achillea-types` ; contrat versionné |
| Base | 56 fichiers `Migration*.ts` MikroORM ; la documentation source indique 47 migrations appliquées en production | migration séparée sous `apps/achillea-bot/database/migrations` (not in repo) |
| Vérification | 44 fichiers de tests repérés dans bot/web/packages | gates ciblées avant toute gate RG globale |
| Opérations | 13 docs, 16 fichiers d'infra, 20 scripts, Docker + workflows GitHub | adapter un par un ; ne pas copier l'automatisation de production telle quelle |

Le dépôt source a son propre `package.json`, son propre catalogue Bun et trois lockfiles
(`bun.lock` racine, `apps/bot/bun.lock` (not in repo), `apps/web/bun.lock` (not in repo)). Ces lockfiles et artefacts n'ont
pas été importés : les workspaces `apps/achillea-*` et `packages/achillea-*` utilisent désormais
le lockfile unique RG. À titre
de repère, l'inventaire RG compte 2 294 fichiers suivis sous `apps`, 1 382 sous `packages`,
115 sous `scripts`, 52 sous `infra` et 91 sous `docs` ; les surfaces Achillea identifiées
ci-dessous sont des points de contact dans cet arbre, pas un workspace déjà intégré.

### 8.2 Cartographie des surfaces déjà présentes dans RG

| Surface RG | Ce qu'elle fait aujourd'hui | Décision |
| --- | --- | --- |
| `apps/rg/bot/src/services/achillea.ts` | Client distant Zod pour `GET /guilds`, `/guilds/stats`, `/guilds/:id` | garder comme adaptateur de compatibilité, puis le faire reposer sur un client partagé |
| `apps/rg/bot/src/commands/achillea.ts` + `src/lib/achillea-format.ts` | commandes Discord et formatage des rôles/salons ; 102 rôles et 113 salons observés lors du scan | ne pas le confondre avec le bot Achillea porté |
| `packages/rg/cron/src/tasks/stats/achillea.ts` | collecte SSH toutes les 15 minutes vers `/var/lib/rg/achillea-audience.json` | garder hors du runtime Achillea tant qu'aucun endpoint de métriques contractuel n'existe |
| `apps/rg/website/src/app/api/public/achillea/info/route.ts` | lit les réglages `home_achillea_*` de la base RG | rester une donnée éditoriale RG, pas un proxy implicite vers la DB Achillea |
| `apps/rg/website` / `apps/azalee` (not in repo) | deux `AchilleaBanner` divergentes et des copies d'assets | mutualiser seulement après arbitrage design ; éviter une déduplication destructive |
| `packages/rg/assets/public/achillea` | réserve d'assets partagés déjà présente | distinguer assets de marque RG et assets privés du build Angular |
| `infra/nginx/api.rosegriffon.fr` | bloc `/achillea/` écrit dans le dépôt mais non activé automatiquement | activer seulement après allowlist, CORS et tests de contrat |
| `infra/nginx/achillea.rosegriffon.conf` | vhost Achillea déjà versionné, avec chemins de releases propres à l'ancien déploiement | choisir un propriétaire canonique puis adapter les chemins ; ne pas dupliquer les vhosts |
| `scripts/ops/deploy.ts` (not in repo) / `scripts/ops/infra.ts` (not in repo) | déploiement bleu/vert enregistré pour website/Azalée ; préfixes systemd RG sans Achillea | ajouter un adaptateur Angular/systemd séparé, après un build local reproductible |
| `packages/rg/db` + `apps/rg/website/supabase` | client, types et migrations de la base Supabase RG | ne jamais mélanger avec MikroORM/Supabase Achillea |

### 8.3 Topologie cible et décisions non négociables

| Surface | Chemin cible | Responsabilité |
| --- | --- | --- |
| Frontend | `apps/rg/website` | routes, assets et configuration publique Achillea sous `/achillea` |
| Backend | `apps/achillea-bot` (not in repo) | Discord, API Ts.ED, jobs, migrations et orchestration ranked |
| Cœur métier | `packages/rg/achillea-core` | logique pure sans ORM, Discord, DI ou secrets |
| Contrats | `packages/rg/achillea-types` | DTO/enums partagés entre front, backend et clients |
| Client RG optionnel | `packages/rg/achillea-client` | transport HTTP + validation Zod pour les consommateurs RG ; à créer après stabilisation du contrat |

1. Ne pas copier Achillea dans `apps/rg/bot` : ce chemin appartient à `@rosegriffon/bot` et
   son Supabase est partagé avec le site RG. Les noms de chemins dédiés sont une frontière
   d'ownership, pas un simple rangement.
2. Conserver d'abord les noms de packages source (`achillea-bot`, `achillea-web`,
   `@rosegriffon/achillea-core`, `@rosegriffon/achillea-types`) pour limiter les changements simultanés ; une
   éventuelle renommée `@rosegriffon/*` sera une migration séparée.
3. Garder le backend en configuration locale CJS + `tsc-alias` et le front en configuration
   Angular propre. RG utilise ESM + `moduleResolution: Bundler` ; un héritage mécanique du
   `tsconfig.base.json` RG casserait les décorateurs Ts.ED/MikroORM et les alias `@/*`.
4. Préserver `achillea.rosegriffon.fr`, `ranked.rosegriffon.fr` et les upgrades WebSocket
   avant tout alias `api.rosegriffon.fr/achillea/v1/`. Le portage du code ne signifie pas
   migration immédiate de l'hébergement.
5. Créer un ledger de dépendances avec version, licence, runtime et provenance. Au minimum,
   il couvre les familles absentes du catalogue RG : Angular/PrimeNG, Ts.ED, MikroORM 7,
   Colyseus, Socket.IO client/serveur, BullMQ/ioredis, `@casl/ability`, `brackets-*`,
   `rxjs`, `@sindresorhus/transliterate` et les paquets `@aphrody/*`.
6. Arbitrer explicitement le décalage `@aphrody/*` du source Achillea contre
   `@aphrody-code/*` utilisé par RG, notamment pour `canvas` et son paquet natif optionnel.
   Un alias de package ne sera accepté qu'après build et test du workspace concerné.
7. Mettre à jour `scripts/rg/check-imports.ts`, `turbo.json`, `.oxlintrc`, CODEOWNERS et les
   gates CI pour les nouveaux chemins ; les scripts source qui hardcodent `apps/rg/bot`,
   `apps/web` (not in repo) ou `/home/ubuntu/achillea` ne sont pas réutilisables sans adaptation.

### 8.4 Frontière runtime, données et sécurité

Le portage doit conserver cette topologie, car les processus ne sont pas interchangeables :

| Port | Processus | Flux interne à préserver |
| --- | --- | --- |
| `4000` | API REST Ts.ED du bot | contrôleurs, auth cookie/JWT, Swagger et tâches bot |
| `4002` | sous-processus Colyseus + routes ranked | relaie certaines routes `/api` vers `127.0.0.1:4000` |
| `4005` | Socket.IO | notifications et temps réel avec handshake JWT |

`apps/bot/src/main.ts` (not in repo) démarre le serveur REST et le Socket.IO puis lance le ranked en
sous-processus Bun ESM ; `src/ranked/main.ts` appelle le port REST local pour les notifications
et les preuves de litige. Le premier service intégré doit conserver cette relation et un
arrêt groupé. Il ne faut pas brancher le ranked sur `@rosegriffon/bot` ni réutiliser ses ports.

La base Achillea est une base Supabase/PostgreSQL séparée, utilisée par MikroORM et ses
60 fichiers d'entités ; la base RG possède ses propres migrations `apps/rg/website/supabase`
et `apps/rg/website/sql`. Avant toute exécution, il faut :

- créer une cible de développement/test Achillea distincte ;
- faire un dry-run et une sauvegarde avant les migrations, en particulier pour les migrations
  de reset de ladder/ELO, dont le `down` est explicitement irréversible ;
- choisir un seul propriétaire des migrations en production. Le code source peut appliquer
  les migrations au boot, tandis que sa CI sait aussi les appliquer : cette concurrence doit
  être supprimée avant un éventuel service intégré ;
- garder les secrets dans un `EnvironmentFile` ou un secret store hors Git, sans fusion avec
  `.env` RG : tokens Discord/OAuth, JWT, pooler, Redis, stockage, `RANKED_INTERNAL_SECRET`
  et clé d'upload ont des périmètres distincts ;
- exclure snapshots SQLite/SQL, `storage`, `uploads`, preuves de litige, logs et backups du
  portage de sources. Ils peuvent contenir des PII ou des fichiers utilisateurs.

Les deux copies de systemd source (`infra/systemd` et `apps/bot/infra` (not in repo)) diffèrent ; la copie
racine est la candidate canonique, mais ses chemins `/home/ubuntu/achillea` et ses timers
doivent être paramétrés avant toute installation. Même règle pour les vhosts Nginx déjà
présents dans RG : une seule source versionnée, une seule procédure d'activation.

### 8.5 Contrat HTTP, auth et temps réel

Le backend source expose 25 contrôleurs et 181 handlers REST déclarés. La surface mélange
lecture publique, auth cookie, rôles staff/dev, endpoints internes et upload. Il est donc
interdit de transformer `/achillea/` en proxy ouvert de tout `/api/*`.

1. Générer un manifeste route/méthode/guard depuis les contrôleurs Ts.ED et les routes
   ranked, puis le relire manuellement. Les candidats lecture sont par exemple health,
   guilds, clans/tournois/leagues et certains profils/licences ; auth, admin, wallet,
   sanctions, notes, DB, proxy upload et callbacks OAuth restent privés jusqu'à preuve
   contraire.
2. Ajouter des tests de contrat pour statut, enveloppe JSON, pagination, snake/camel case,
   erreurs `401/403/404` et champs nullable. Le client RG actuel ne couvre que trois GET
   guilds avec validation Zod ; il ne constitue pas le contrat complet du front Achillea.
3. Placer les schémas runtime et le transport partagé dans `packages/rg/achillea-client` ou,
   à défaut, dans un adaptateur unique par consommateur. Aucun `fetch` libre ne doit créer
   un second contrat silencieux.
4. Garder le chemin historique `/api/*` de `ranked.rosegriffon.fr` pendant la transition.
   L'alias `/achillea/v1/*` ne devient canonique qu'après tests de réécriture et de rollback.
5. Traiter séparément REST, Socket.IO et Colyseus : une `location` Nginx HTTP ne suffit pas
   pour les upgrades WebSocket. Vérifier CORS, `WEB_ALLOWED_ORIGINS`, cookies cross-domain,
   `Authorization`, `x-forwarded-host` et les callbacks Discord avant d'exposer l'auth par
   la gateway.
6. Conserver les garde-fous d'upload : le ranked encode actuellement les preuves en base64
   texte à cause de la couche Bun/Express et valide les magic bytes. La gateway doit imposer
   des limites de taille/timeout et ne pas publier d'endpoint binaire sans test de non-corruption.

### 8.6 Front Angular, assets et SEO

Le front possède 37 entrées de routes, des métadonnées globales et du JSON-LD dans
`apps/web/src/index.html` (not in repo), mais `angular.json` ne configure pas de SSR/prerender et aucun
sitemap dynamique n'est présent. Le plan SEO reste donc valable, mais il faut distinguer
ce qui existe déjà de ce qui manque :

- conserver Angular/PrimeNG et ses assets pendant le portage ; ne pas convertir la surface
  en Next.js pour la faire entrer artificiellement dans RG ;
- rendre `apiBaseUrl`, `socketUrl`, `colyseusUrl`, CDN et configuration Supabase injectables
  au build/deploy. La configuration prod actuelle pointe directement `ranked.rosegriffon.fr`
  et un projet Supabase Achillea distinct ; la clé publique Supabase n'est pas un secret,
  les autres variables ne doivent pas être embarquées ;
- garder les assets spécifiques désormais consommés par `apps/rg/website/public/achillea` et placer seulement les
  assets de marque réellement partagés dans `packages/rg/assets`. Inventorier les doublons
  `apps/rg/website/public/achillea`, `apps/azalee/public/achillea` (not in repo) et le package avant toute
  suppression ; réécrire séparément les anciennes URLs `api.alessf.fr` ;
- remplacer le script source de publication, qui suppose `/home/ubuntu/achillea` et
  `apps/web/dist/achillea-web/browser` (not in repo), par un adaptateur compatible avec les releases RG.
  Le déploiement bleu/vert RG actuel ne connaît que website/Azalée ; aucune bascule Angular
  ne doit être déduite de son seul succès ;
- livrer d'abord le build SPA fonctionnel et ses sondes, puis ajouter prerender des routes
  publiques, `sitemap.xml`, canonical, OG/Twitter, JSON-LD par entité et robots. Le SEO ne
  doit pas retarder la réintégration testable du code.

### 8.7 Phases d'exécution et gates

**État vérifié le 7/9/2026** : Gate 0 et Gate 1 sont acquises. Les validations statiques de
Gate 2 et Gate 3 passent (backend, packages, frontend, artefacts et tests sans secrets), mais
leurs sondes live restent conditionnées à la base locale et aux secrets rotatés. Gate 4 est
partielle : le client partagé est branché dans le bot RG, tandis que gateway/CDN ne sont pas
activés. Gate 5 est préparée par des scripts à refus par défaut ; aucun dump Cloud, restore,
service, DNS ou proxy n'a été exécuté par cette campagne.

#### Phase 0 — Rebaser et importer proprement

- figer le commit source audité et produire un manifeste des fichiers importés ;
- préparer les quatre destinations de portage dédiées, puis réserver
  `packages/rg/achillea-client` à la validation du contrat ; ne pas toucher à `apps/rg/bot`,
  `packages/rg/db` ou aux migrations RG ;
- exclure `.git`, `node_modules`, les trois lockfiles source, `.env*`, builds/dist/.angular,
  snapshots, dumps, storage/uploads/logs, certificats, workflows de déploiement source et
  la copie `apps/bot/infra` (not in repo) non canonique ;
- produire le ledger de dépendances et la matrice source→RG avant d'exécuter un install global.

**Gate 0** : aucun secret/artefact runtime importé, aucune collision de chemin, diff d'import
reproductible et décision écrite pour chaque dépendance critique.

#### Phase 1 — Workspaces purs et contrats

- porter `@rosegriffon/achillea-types`, puis `@rosegriffon/achillea-core` ; ajouter leurs scripts ciblables ;
- créer les schémas/DTO publics et le client HTTP optionnel ; documenter la version du contrat ;
- adapter `tsconfig`, `turbo`, lint et check-imports en gardant les réglages locaux CJS/Angular ;
- régénérer un unique lockfile RG seulement après validation des manifests.

**Gate 1** : install frozen depuis la racine, type-check/lint/tests des packages, aucune
dépendance vers un module privé RG et aucune régression des workspaces existants.

#### Phase 2 — Backend et ranked isolés

- porter `apps/rg/bot` vers `apps/achillea-bot` (not in repo) en conservant les tests, plugins, 56 migrations
  et le découpage REST/ranked/Socket.IO ;
- rendre les chemins, ports et répertoires runtime configurables sans renommer aveuglément
  les variables source ;
- exécuter les tests sans base de production, puis un dry-run de migrations sur une cible
  Achillea dédiée ;
- écrire l'unité systemd et les sondes RG seulement après que le build CJS, le spawn ranked
  ESM et l'arrêt groupé soient prouvés localement.

**Gate 2** : build backend propre, health `4000/4002`, Socket.IO `4005`, test d'un appel
interne ranked→REST, tests unitaires/db ciblés et preuve qu'aucune migration RG n'est vue.

#### Phase 3 — Front Angular

- migration terminée de `apps/web` (not in repo) vers `apps/rg/website`, assets, environnements et chemins API ;
- vérifier les 37 routes, auth, upload, ranked/Colyseus, Socket.IO et les builds dev/prod ;
- ajouter les liens RG manquants côté Achillea, puis les tests de navigation et de contenu.

**Gate 3** : `dist` inspecté, smoke tests des routes publiques et authentifiées, aucune URL
locale ou IP de VPS dans l'artefact prod, et aucun secret dans le bundle.

#### Phase 4 — Adaptateurs RG, CDN et gateway

- faire consommer le client/contrat partagé par le bot RG et, si nécessaire, website/Azalée ;
- conserver `stats:achillea` en SSH jusqu'à la disponibilité d'une métrique HTTP versionnée ;
- décider l'ownership des bannières/assets et migrer les legacy URLs avec inventaire ;
- activer la gateway en lecture seulement après manifeste de routes, tests CORS, sondes et
  rollback documenté ;
- ajouter Achillea au registre de déploiement/infra RG uniquement quand son runtime est
  indépendant et que ses secrets, releases et ports sont explicitement déclarés.

**Gate 4** : contrats validés à l'exécution, gateway non ouverte aux routes privées, CDN sans
404 pour les assets migrés, et tests RG existants toujours verts.

#### Phase 5 — Cutover facultatif, séparé du portage

- canary ou environnement parallèle, avec observation du bot et du ranked ;
- validation explicite des sauvegardes, migrations, certificats, DNS, CORS/OAuth et rollback ;
- bascule seulement après décision d'exploitation distincte ;
- conserver l'ancien origin et une procédure de retour sans rollback SQL destructif.

### 8.8 État des décisions au 7/9/2026

| Sujet | État | Suite |
| --- | --- | --- |
| Client RG guildes/rôles/salons | en service, distant, validé par Zod | conserver comme compatibilité puis centraliser |
| Maillage website/Azalée | largement en place, copies divergentes | mutualiser après design commun |
| Bloc Nginx `/achillea/` | écrit dans RG, non activé par ce plan | allowlist + contrat + approbation |
| Workspaces Achillea dans RG | importés, lockfile racine reproductible | maintenir les gates ciblées |
| Portage backend/frontend/core/types | réalisé et validé sans secrets live | sondes avec environnement isolé |
| Base/migrations/secrets | cible `achillea` et outils préparés, aucune restauration | fournir des credentials rotatés hors Git |
| Storage | migration d'octets idempotente préparée | exécuter après restore et gel des écritures |
| Auth Supabase | schéma inclus dans le dump, GoTrue local absent | qualifier GoTrue avant toute bascule Auth |
| DNS, certificats, systemd production | non activés | Gate 5 uniquement |
| SEO SSR/prerender/sitemap | partiel/global seulement | après le build SPA fonctionnel |

### 8.9 Opérations séparées du portage de code

- les secrets réels restent hors Git ; tout identifiant divulgué doit être révoqué avant usage ;
- le dump Cloud, la restauration dans `achillea` et la copie des octets Storage utilisent les
  runbooks dédiés, une fenêtre de gel et des inventaires source/cible ;
- modification destructive d'une base, rollback SQL destructif ou exécution des migrations
  sur la base RG ;
- bascule DNS, rechargement Nginx, redémarrage systemd, changement OAuth ou déploiement public ;
- fusion aveugle de `bun.lock`, `node_modules`, builds, caches, workflows ou infrastructures ;
- remplacement d'Achillea par le bot RG, le cron RG, Next.js ou la base commune RG.

### 8.10 Critères d'acceptation finaux

- chaque workspace Achillea est ciblable indépendamment par Bun/Turbo depuis `../rg` ;
- `bun install --frozen-lockfile` et les gates ciblées passent dans un checkout propre ;
- les tests RG existants restent verts et les tests Achillea restent exécutables sans secrets
  de production ;
- les artefacts backend/frontend sont inspectés, les ports et probes sont documentés, et le
  ranked→REST ainsi que Socket.IO sont testés ;
- les contrats HTTP sont versionnés, validés à l'exécution et couverts par des tests de dérive ;
- les bases, migrations, secrets, assets runtime et services restent séparés et réversibles ;
- la documentation sépare toujours faits vérifiés, résultats live historiques, hypothèses et
  actions nécessitant une approbation d'exploitation.

## Références

- docs/la stratégie SEO du dépôt · [docs/deploy.md](../../operations/rg/deploy.md)
- CDN : endpoint `cdn.rosegriffon.fr` (`cdn.service`, content-addressé `/images/<hash>` + `/upload`) ·
  nginx `conf.d/cdn.rosegriffon.conf`, `api.rosegriffon.conf`
- Repo Achillea : `rose-griffon/achillea` (front `apps/web` (not in repo), bot `apps/rg/bot`, `docs/supabase-prod.md` (not in repo))
