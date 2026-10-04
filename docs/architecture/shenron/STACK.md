> **Architecture courante (2026-09-28).** Les surfaces IA, clients Aphrody, pipeline de traitements et pont BXC sont réunis dans le workspace `@shenron/pipeline` (`packages/shenron/pipeline`). Les sous-chemins `@shenron/pipeline/ai/*`, `@shenron/pipeline/aphrody/*` et `@shenron/pipeline/bxc` désignent des modules de ce paquet, pas des paquets workspace distincts. Les descriptions et graphes plus bas consignent en partie l’architecture historique de la vague 1.

# Pile unifiée Shenron (`@shenron/*`)

Les paquets Shenron sont en amont des clients Aphrody : les dépôts Aphrody
peuvent consommer `@shenron/*` et les contrats HTTP Shenron. Le workspace
Shenron n'importe aucun paquet de code `@aphrody/*` ni checkout frère
`../aphrody-*`. Le catalogue de l'Infra du monorepo reste la source opérationnelle
des ports et services pour les tunnels locaux.
Le code Aphrody Discord appartient au monorepo ``, pas
au workspace Shenron ; le bot consomme les paquets Discordx publiés.

Document d'architecture de référence pour l'unification des surfaces base de
données, authentification, IA, API et interface de Shenron. Il fixe les
paquets, leurs frontières, leurs API publiques, l'ordre de migration et les
gates. Le découpage exécutable de la Phase 1 (une vague par ligne, un agent par
paquet, chemins possédés disjoints) était généré dans
`var/stack-research/work-breakdown.json` (not in repo); cet artefact de recherche n'est pas versionné.
Le registre courant est [`PLAN.md`](../../../PLAN.md).

Il complète :

- [`APHRODY-ECOSYSTEM.md`](APHRODY-ECOSYSTEM.md) : ce que Shenron confie à
  l'écosystème Rust d'Aphrody et par quelles frontières ;
- [`APHRODY-OFFLOAD.md`](../../operations/shenron/APHRODY-OFFLOAD.md) : état et preuves du déport RAG ;
- [`INFRA-DELEGATION.md`](../../operations/shenron/INFRA-DELEGATION.md) : frontière d'exploitation avec
  l'Infra du monorepo ;
- `PLAN.md` : registre des décisions, invariants et journal de validation.

État relevé le 2026-09-24 (HEAD `1be3116a`) sur le poste Windows de développement : Bun 1.4.2,
TypeScript 7.0.2 (tsc natif, sans API JavaScript), Next 16.3.5, React 19.3.0,
drizzle-orm 0.45.3, better-auth 1.7.5, hono 4.13.2, @hono/zod-openapi 1.6.3
(zod-to-openapi 9.1.0), zod 4.6.5, ai 7.0.107, @ai-sdk/openai-compatible 3.0.53,
@ai-sdk/provider 4.0.17, @base-ui/react 1.8.0, oxlint 1.81.0. Sources de
recherche : `var/stack-research/*` (cartes par surface, critique de
complétude, scans Aphrody, verdicts).

**Mise à jour du 2026-09-26.** Ce document garde son journal de conception
daté du 24 septembre ; ses mentions de `shenron-mcp` sont historiques. Le
serveur Bun et l'unité séparée ont été retirés : les outils Dragon Ball sont
dans `aphrody-ai/crates/aphrody-mcp` (`dragonball.*`). La carte actuelle est
[`APHRODY-ECOSYSTEM.md`](APHRODY-ECOSYSTEM.md), les outils exacts sont dans le
catalogue `docs/ecosystem/MCP-TOOLS.md`.

**Convention.** Ce document ne contient ni hôte, ni IP, ni port, ni chemin
absolu d'hôte. Un service est désigné par son identifiant dans
`config/service-catalog.json` (`shenron-bot`, `shenron-site`,
`aphrody-ai-http`, `aphrody-shenron-embed`, `aphrody-web-api`,
`shenron-pg-tunnel`…), et un client le trouve par une variable
d'environnement provisionnée par l'Infra du monorepo. Les hôtes publics sont
déclarés dans `config/nginx-routes.json`.

---

## 1. Objectif et principes

### 1.1 Objectif

Remplacer les copies divergentes (≈ 115 résolveurs de `DATABASE_URL`, 7
comparaisons à temps constant, 4 gardes loopback, 10 clients HTTP du bot écrits
à la main, 2 moteurs de politique d'accès, 3 implémentations de métriques RAG)
par six paquets privés `@shenron/*` consommés en source, sans changer le
comportement observable hors registre (§2.2), et en laissant tout calcul lourd
à Aphrody derrière une frontière de processus.

| Paquet | Statut | Rôle |
| --- | --- | --- |
| `@shenron/config` | nouveau | presets tsconfig TS7, lecture d'environnement, gardes réseau, chemins mutables, kit de gardes de portabilité |
| `@shenron/db` | étendu | PostgreSQL (source de vérité éditoriale) : schémas Drizzle, pilotes, clients bruts, dépôts, gel databooks, Redis résilient |
| `@shenron/auth` | étendu | Better Auth 1.7.5 : primitives crypto, jetons, politique staff, gardes renvoyant un principal, adaptateurs Next/Hono/navigateur |
| `@shenron/api` | construit | contrat zod, client typé sans exception, application OpenAPIHono montée dans les processus existants |
| `@shenron/ui` | construit | Base UI 1.8 + Tailwind v4 : `cn`, jetons CSS, wrappers, `pageWindow`, icônes |
| `@shenron/pipeline` | consolidé | modules `ai/*`, `aphrody/*`, pont BXC et workflows OCR/RAG/traduction/crawl |

`@shenron/pipeline/ai/*`, `@shenron/pipeline/aphrody/*` et
`@shenron/pipeline/bxc` sont des sous-chemins publics d'un seul workspace ; ils
ne forment pas des paquets workspace distincts.

### 1.2 Principes

1. **Étrangleur, suppression en deux temps.** Le nouveau code arrive à côté de
   l'ancien ; la bascule d'un consommateur est un commit à part ; l'ancienne
   implémentation n'est supprimée qu'une vague entièrement verte plus tard.
   Toute bascule se reverte seule, sans réimplémentation.
2. **Façades aux anciens chemins.** Les tests du site simulent
   `@/lib/session`, `@/lib/api-token`, `@/lib/env`, `@/lib/db` et
   `@/lib/config` ; environ 28 suites lisent des fichiers source par chemin ;
   les cales `apps/site/src/db/{schema,bot-schema}.ts` ont 56 et 17
   importateurs. Aucun de ces chemins ne bouge.
3. **Les gates d'abord.** La CI est rouge aujourd'hui (scaffolds vides
   `ai`/`api`/`ui`, ESLint cassé par TS7, TS2345 dans
   `apps/shenron/site/scripts/fill-ja-identities.ts:206`, POLICY de `test-all`
   incomplète). La vague 1 les répare avant tout travail de paquet.
4. **Injection, pas de configuration ambiante.** Un paquet n'importe jamais
   `server-only`, `next/*` (hors sous-chemin `./next`), `@/…`, un chemin
   relatif vers `apps/**`, `tsyringe`, `@aphrody/*` ni `bun:ffi`. Il ne lit pas
   `process.env`, `Bun.env` ni `import.meta.env` au chargement du module :
   l'appelant injecte la configuration, ou une fonction lit un `EnvSource`
   au moment de l'appel.
5. **Une classe d'exécution par sous-chemin.** Chaque entrée `exports`
   déclare sa classe dans `package.json` (`"shenron": { "runtime": {…} }`).
   Un parcoureur partagé (`@shenron/config/guards`) suit la fermeture
   transitive des imports de chaque entrée et fait respecter la classe.
6. **Ports déclarés par le consommateur.** Le paquet qui consomme déclare
   l'interface (`WikiReadPort` dans `@shenron/api`, `AgentKeyStore` dans
   `@shenron/auth`) ; le propriétaire l'implémente structurellement, sans
   importer le consommateur ; un test de conformance à la compilation
   (`createWikiReadRepository(drizzle.mock({ schema })) satisfies WikiReadPort`)
   le prouve. Le graphe d'exécution reste acyclique.
7. **Clients sortants sans exception.** Union `Result`, `fetch` injectable et
   résolu tard (à chaque appel, pour que les tests qui remplacent
   `globalThis.fetch` continuent de fonctionner), délai par appel
   (`AbortSignal.timeout`), `safeParse` zod des réponses, et des erreurs qui
   ne portent que méthode, chemin et statut, jamais un jeton ni un corps.
8. **Aucun changement de comportement hors registre.** Le registre S/B (§2.2)
   liste les seuls écarts permis ; chacun est un commit revertable avec son
   test. Tout autre changement observable (statut, corps, en-tête, SQL, CSS,
   message Discord) est un défaut.
9. **Niveaux de vérification explicites** (§2.3) : rien n'est dit « vérifié »
   au-dessus du niveau réellement exécuté.
10. **Limites d'exploitation.** Aucune nouvelle unité systemd, aucun
    déploiement, aucune écriture en base de production. Le calcul lourd
    passe par Aphrody. Toute nouvelle résolution respecte
    `minimumReleaseAge = 3 jours` de `bunfig.toml`.
11. **Dépôt multi-agents.** Un agent par paquet et par vague, chemins possédés
    disjoints ; l'orchestrateur seul installe, commit et édite les fichiers
    partagés (§7.1).

---

## 2. Décisions

### 2.1 Décisions d'architecture

**D1. TypeScript 7.0.2 partout, oxlint seul linter.** Le `tsc` natif n'a pas
d'API JavaScript : `typescript-eslint` (pair `<6.1`), `tsup --dts` et typedoc
ne fonctionnent plus. ESLint est retiré du site au profit d'oxlint avec les
plugins `nextjs`, `react`, `jsx-a11y` et `import` (noms valides du schéma
oxlint 1.81). Next 16.3.5 vérifie les types par la ligne de commande
(`experimental.useTypeScriptCli`, vrai par défaut) ; on l'écrit explicitement
dans `apps/shenron/site/next.config.ts` pour qu'un changement du défaut expérimental ne
bascule pas vers le chemin API, qui lève E1467 sous TS7. `oxlint-tsgolint`
(lint typé) reste optionnel et non bloquant.

**D2. Paquets privés, consommés en source.** Modèle `rg/packages/images` et
`packages/shenron/images` : `"private": true`, `exports` vers `./src/*.ts`,
`workspace:*` et `catalog:`, pas de `dist`, pas de tsup. Next les consomme via
`transpilePackages`, Bun tels quels. Les helpers propres à Next vivent
uniquement dans un sous-chemin `./next`.

**D3. Presets tsconfig sans `include`.** `@shenron/config/tsconfig/{base,bun,react}.json`
ne déclarent ni `include`, ni `baseUrl`, ni `paths`, ni `ignoreDeprecations` :
un `include` se résout relativement au fichier qui le déclare, ce qui
provoquerait TS18003 dans chaque paquet (vérifié sous TS 7.0.2). Chaque paquet
étend le preset par chemin relatif (`"../config/tsconfig/bun.json"`) et
redéclare son `include`. `noUncheckedIndexedAccess` n'est activé que par les
paquets neufs (`config`, `ai`, `api`) dans leur propre tsconfig, jamais dans
un preset (il ferait passer `bxc-bridge` à 14 erreurs). `apps/shenron/site/tsconfig.json`
reste autonome : Next cesse de le maintenir dès qu'il voit `extends`.

**D4. Drizzle ORM 0.45.3, deux pilotes, clients bruts séparés.** postgres-js
pour le site Next (PostgreSQL local, `prepare: true`), Bun.SQL
(`drizzle-orm/bun-sql`) pour le bot, les scripts et l'API montée dans le bot.
`drizzle()` modifie les sérialiseurs du client postgres-js qu'on lui passe
(`drizzle-orm/postgres-js/driver.js:15-22`) : `sql.json()` cesse de
sérialiser, ce qui casserait 65 scripts. `createSql()` et `createBunSql()`
rendent donc des clients bruts qui ne sont jamais passés à Drizzle. Le pilote
`drizzle-orm/bun-sql`, lui, ne modifie pas le client (vérifié dans
`driver.js`) : le `PgService` du bot peut partager un seul pool Bun.SQL entre
Drizzle et le SQL brut. La racine
`@shenron/db` garde sa réexportation historique de `createDb` jusqu'à une
vague ultérieure verte. Les relations restent sur l'API v1 `relations()`.

**D5. Aucune migration déplacée ni rejournalisée en Phase 1.** Le déploiement
l'Infra du monorepo exécute `bun run site:migrate` (`drizzle-kit migrate`) : journaliser
les 8 fichiers non journalisés (0007–0011, 0015, 0018, 0019) ou scinder le DDL
`bot.*` appliquerait du DDL en production à la release suivante. La Phase 1
livre un audit hors ligne (`packages/shenron/db/scripts/migration-audit.ts`) et un
garde-fou : `drizzle.config.bot.ts` refuse `push`/`migrate`, `db:push` du site
refuse de s'exécuter. La réparation de l'historique est le ticket DB-P3,
coordonné avec le runbook de l'Infra du monorepo.

**D6. Auth : primitives synchrones, politique staff par périmètre, silos
séparés.** Les primitives crypto utilisent `node:crypto` de façon synchrone
(Bun et runtime Node de Next ; le proxy l'utilise déjà) : les façades
synchrones (`verifyAdminCookie` dans `proxy-admin.ts`) ne deviennent pas des
promesses. La politique staff a deux périmètres :
`staffPolicyFromEnv(env, "bot")` = `OWNER_ID ∪ OWNER_IDS ∪ BOT_DEV_ID ∪ OAUTH_ALLOWED_USERS`,
`staffPolicyFromEnv(env, "site")` = `OWNER_ID ∪ OAUTH_ALLOWED_USERS` (sémantique
actuelle, inchangée). Les silos Better Auth du site (PostgreSQL) et du bot
(SQLite) ne fusionnent pas ; l'escalade vivante du bot (`checkAdmin` accepte
toute session Better Auth ou cookie hérité, `apps/shenron/bot/src/api/auth.ts:34-40`)
est corrigée dès la vague 1 (S1). `@shenron/auth` ne dépend pas de
`@shenron/db` à l'exécution : les dépôts vivent dans `@shenron/db/repos/*` et
satisfont les ports de l'auth.

**D7. API Hono montée, jamais en unité séparée.** l'Infra du monorepo a retiré
`shenron-api.service`. `createShenronApi(ports)` est montée :
- dans le bot, par le repli `fetch` de `Bun.serve`, juste avant le 404 JSON :
  `if (shenronApi.handles(pathname)) return shenronApi.fetch(req)`. Les clés
  `routes` existantes gardent la priorité (exact > `:param` > `/*` > `fetch`),
  et `handles()` ne revendique que les groupes dont le port est présent ;
- dans le site, par un catch-all borné `app/api/public/[...route]/route.ts`
  (répertoire inexistant aujourd'hui ; jamais de catch-all racine `/api`).

En Phase 1, Hono ne sert que des routes **nouvelles** (catégories et entités
wiki lues dans PostgreSQL, document OpenAPI). `/health`, `/api/health`,
`/api/public/stats`, les routes RAG et `/api/openapi.json` restent servis par
le code historique tant qu'un instantané de parité d'en-têtes n'existe pas
(SH-API-2).

**D8. Contrat en zod pur.** `@shenron/api/contract` n'importe que `zod` et
`@shenron/db/constants` ; les métadonnées OpenAPI passent par
`.meta({ id })`, que zod-to-openapi 9.1.0 transforme en composants (vérifié).
Le registre des catégories wiki répond `{ categories: [{ name, label, total }] }`,
la forme reprise par `dragonball.wiki_categories` dans
`aphrody-ai/crates/aphrody-mcp/src/dragonball_tools.rs`. L'enveloppe d'erreur reste compatible avec les corps
actuels (`{ "error": "Not found" }`) et gagne un `code` optionnel.

**D9. IA : AI SDK v7, adaptateur de chat sur mesure.** `/api/v1/shenron/llm/chat`
ne diffuse pas en flux et n'accepte pas d'outils : un `LanguageModelV4` sur
mesure l'enveloppe. `createOpenAICompatible` sert au transport E5 direct et
reste prêt pour un futur chat OpenAI-compatible authentifié (APH-3). Pas de
`@ai-sdk/react` (aucune interface en flux). Aucun `bun:*`, `node:*`, Redis ni
SQLite dans `@shenron/pipeline/ai` : le stockage entre par des ports.

La propriété de l'implémentation IA profonde est à `aphrody-ai` : modèles,
inférence, clients fournisseurs, OCR/vision et moteurs RAG vivent dans ses
crates et son service. `@shenron/pipeline` ne garde que l'adaptateur du contrat
privé Shenron, le choix E5 et l'orchestration qui applique le corpus et les
règles canoniques Shenron. Toute capacité générique ajoutée doit être fournie
par Aphrody AI puis consommée ici par une façade ; le pipeline ne doit pas
recréer un moteur ou un client fournisseur parallèle.

**D10. Embeddings : transport choisi par configuration.** Voie principale
`POST /api/v1/shenron/embed` sur `aphrody-ai-http` : le serveur ajoute le
préfixe E5 `query: `/`passage: ` après `trim` (`http_rest.rs:1058-1064`),
donc le client **n'en ajoute pas**. Voie de repli `aphrody-shenron-embed`
`/v1/embeddings` : le client préfixe **une seule fois**. Le client réduit les
espaces (`\s+` → ` `) sur les deux voies, envoie au plus 16 entrées par appel,
séquentiellement, vérifie nombre, ordre des index, 384 dimensions et valeurs
finies, et appelle avec `maxRetries: 0` sur le chemin chaud. Le transport est
choisi par la configuration, jamais par bascule par requête.

**D11. `@shenron/pipeline/aphrody` sans FFI, source seule.** Le pont
`AphrodyNativeBridge` (`bun:ffi`, `bun:sqlite`, `searchMemory`, `mcpCall`) n'a
aucun consommateur hors de son propre test : il est supprimé ; `doctor` et
`git inspect` passent par la CLI (`./cli`, `Bun.spawn`, scripts seulement).
`measureInkStroke` rejoint `@shenron/images/ink-stroke`. `dist/` est supprimé,
le paquet devient privé et transpilé par Next. La racine ne réexporte plus
que `compute`, `embeddings` et `web`. Le hub A2A (`./a2a`) perd son import de
`apps/shenron/bot` : son notificateur Discord est injecté par
`ShenronA2AHub.configure({ notifier, coordDir })`, statique comme `setProbes`
(la classe est entièrement statique).

**D12. UI : Base UI 1.8, Tailwind v4, présentations portables.** `@shenron/ui` porte
`cn`, la couche de jetons (`styles.css`), les jetons générés (`tokens.ts`,
test de dérive), les wrappers Base UI corrigés pour 1.8 et `pageWindow`.
Les vues sans données de `components/kit` (shell, titres, onglets, compteurs,
chips, états vides) sont dans le paquet ; le site conserve de petits adaptateurs
`next/link` et `next/image`. Les vues liées aux sessions, aux routes et aux
données restent dans le site. Le paquet déclare `@source "."` dans
`styles.css` pour les installations hors monorepo ; le tableau de bord du bot
garde son propre scan explicite. La
valeur par défaut d'`ember` reste figée sur le rendu actuel (décision
propriétaire OWN-7).

**D13. Canvas.** Le catalogue épingle directement `@napi-rs/canvas` 1.0.9.
Le bot utilise ses API Skia (`createCanvas`, `loadImage`, `GlobalFonts`) et
ses binaires préconstruits. La sonde de `apps/shenron/bot/src/lib/preload.ts` couvre
les cibles préconstruites ; le shim reste pour les autres plateformes. Le
test de rendu natif `apps/shenron/bot/tests/canvas-render.test.ts` passe sous Linux.
La façade `@aphrody/canvas` utilisée auparavant reste dans l'historique du
dépôt mais ne fait plus partie des dépendances courantes.

**D14. A2A : garde d'écriture activée par drapeau.** Les écritures A2A (bot
`message/send` et `tasks/cancel` ; site `POST /api/a2a`, `GET ?envelopes=1` et
`?view=mailbox`) exigent `Bearer SHENRON_A2A_TOKEN` seulement si
`SHENRON_A2A_ENFORCE` est actif. Par défaut, elles restent ouvertes et
journalisent un avertissement unique. Raison historique : l'ancien
`shenron-mcp` appelait le site sans en-tête
`Authorization` ; activer la garde avant INFRA-2 (jeton provisionné) et MCP-1
(jeton transmis) casserait le chemin A2A canonique.

**D15. Chemins mutables centralisés sans changement.** `resolveDataPath(key, { env, legacyDefault })`
centralise la priorité des variables (`RAG_GOLD_PATH`/`RAG_GOLD`,
`SHENRON_ADMIN_DOCS_DIR`, `A2A_COORD_DIR`/`COORD_DIR`, `DATABOOKS_FREEZE_FILE`,
`RAG_LEXIQUE`) en gardant le défaut actuel de chaque appelant ; en production,
un chemin hérité (relatif à la release) est signalé une fois. Les lectures,
dont celle du jeu d'or livré dans la release, ne deviennent pas bloquantes
avant INFRA-1. Seul le gel databooks devient fermé par défaut en production
(S11), conformément à `PLAN.md` (`freeze.databooks = true`).

**D16. Contrat d'environnement par noms.** Aucune URL, hôte ni port par défaut,
façades `@shenron/pipeline/aphrody/{compute,embeddings}` comprises depuis le contrat IA v1
de l'Infra du monorepo (`config/local-ai.json`, 2026-09-25) : le résolveur unique
`@shenron/pipeline/ai/config` lit d'abord les noms canoniques `APHRODY_AI_*`, puis les alias
hérités dans l'ordre du contrat (voir [`ENV.md`](../../operations/shenron/ENV.md)). Les paires de noms
historiques (`SHENRON_ADMIN_TOKEN`/`API_ADMIN_TOKEN`,
`SHENRON_USER_SECRET`/`API_USER_SECRET`) sont déclarées dans `ENV_ALIASES` et
vérifiées égales, sans jamais afficher de valeur. `EMBED_URL` est un alias de
forme **origine** (le résolveur ajoute `/v1`) de `APHRODY_AI_EMBED_BASE_URL`, qui est
une **base** finissant par `/v1`, comme `APHRODY_SHENRON_EMBED_BASE_URL`.

**D17. Ce qui ne change pas en Phase 1.** Magasins de données (le cockpit IA
lit toujours les miroirs PostgreSQL et écrit dans le SQLite du bot), GraphQL
(contrat public documenté par `aphrody-ai/plugins/aphrody/docs/DRAGON-BALL.md`), routes SQLite
`/api/public/wiki/*` existantes, `/api/chat` du site, schéma SQLite du bot,
suppressions physiques héritées (`admin/wiki/_actions.ts`,
`admin/posts/_actions.ts` : ticket SH-SOFTDEL), identités (silos séparés).

### 2.2 Registre des changements de comportement

Seuls écarts autorisés au « zéro changement ». Un commit et un test chacun ;
retour arrière par `git revert`.

| ID | Changement | Raison | Vague / condition de release |
| --- | --- | --- | --- |
| S1 | `checkAdmin` du bot revérifie la politique staff (bot) pour une session Better Auth (compte Discord lu dans `ba_account`) et pour un cookie hérité `source=discord` ; non-staff → **403** `{"error":"Accès admin refusé."}`. Crochet `databaseHooks.session.create.before` qui refuse une session non-staff. Ordre inchangé : 503 si `API_ADMIN_TOKEN` absent → Bearer (préfixe exact `Bearer `, mauvais jeton = 401 final) → session Better Auth → cookie hérité → 401. | Escalade vivante après retrait de la liste blanche | V1 |
| S2 | Plus d'hôte générique `*.vercel.app` ; `localhost` seulement hors production (hôtes et origines du site, origines du bot, constantes du paquet) ; `proxy.ts` ne laisse plus passer les hôtes de preview Vercel. L'alias Vercel nommé reste jusqu'à INFRA-4. | Origine de confiance générique = redirection ouverte (`helpers.mjs:61-68`) | V1 |
| S3 | IP client du bot = `x-real-ip`, sinon **dernier** saut `X-Forwarded-For`, sinon `unknown` ; un appel loopback direct (socket loopback et ni `x-real-ip` ni XFF) n'est pas limité sur `/health`. | Contournement de la limite par XFF ; sonde infra en 429 | V1 |
| S4 | `/auth/login` du bot limité à 10 tentatives/min/IP (429, `Retry-After: 60`). | Aucune limite de force brute | V1 |
| S5 | Garde d'écriture A2A derrière `SHENRON_A2A_ENFORCE` (D14). Drapeau inactif : comportement inchangé + avertissement unique. Drapeau actif : jeton absent → 503 `a2a_not_configured`, jeton manquant ou faux → 401. | Écritures anonymes dans `.coord` | V1 ; activation après INFRA-2 et MCP-1 |
| S6 | Réponses LLM sur Discord avec `allowedMentions: { parse: [], repliedUser: true }` (`AutonomousChat.ts`, `/ask`). | Un `@everyone` injecté pingait | V1 |
| S7 | Téléversement de tierlist : le bot accepte une signature acting-user pour ce périmètre (V3), puis le site cesse d'utiliser le jeton maître (V4). | Député confus (`tierlists/upload/route.ts:82-87`) | V3 puis V4 |
| S8 | Les 401 anonymes de l'API agents n'écrivent plus de ligne `agent_audit` (compteur échantillonné en mémoire). | Trafic anonyme → écritures SQL | V3 |
| S9 | `/graphql` passe par le limiteur public (60/min/IP). | Travail SQLite et embeddings non mesuré | V4 |
| S10 | Repli de la clé HMAC héritée sur `API_ADMIN_TOKEN` : **avertissement seul** en Phase 1. | Réutilisation de secret | V1 ; bascule en Phase 2 après confirmation de `SESSION_SECRET` (INFRA-2) |
| S11 | Gel databooks fermé par défaut en production quand `DATABOOKS_FREEZE_FILE` est absente. Échappatoire : faire pointer la variable vers un fichier absent ou contenant `{"frozen": false}`. Code de sortie 3 conservé. | `PLAN.md` déclare le gel ; `.coord/` n'est jamais livré | V3 ; INFRA-1 fournit le chemin |
| B1 | `wiki-databooks-indexer.ts getDbUrl` prend la **dernière** ligne active `DATABASE_URL=` (via `loadDatabaseUrl`). | L'URL Neon retirée précède l'URL vivante | V3 |
| B2 | Pools PostgreSQL du bot unifiés par un `PgService` paresseux et nullable (`BxcBridgeService` passe de 10 connexions à celles du pool partagé), `application_name` fixé. | Politique de pool (défaut 4) | V3 |
| B3 | Clients d'embeddings construits paresseusement : une mauvaise URL dégrade en recherche lexicale au lieu de planter à l'import. | Dégradation documentée (`rag.ts:826-875`) | V3 |
| B4 | `bin/shenron.ts --mode` devient effectif (effet de B3). | Variables mutées après import | V3 |
| B5 | `packages/shenron/pipeline/src/workflows.ts` injecte réellement ses citations. | Réponses non ancrées | V3 |
| B6 | `rag-lexique.ts` écrit dans `apps/bot/data/rag/` (not in repo) via `fileURLToPath`. | Chemin dérivé ; `.pathname` faux sous Windows | V4 |
| B7 | Espace de noms du cache sémantique `v2 → v3`, portée incluant `PROMPT_VERSION` ; cache froid une fois. | Pas de réponse en cache à travers un changement de prompt | V3 |
| B8 | Redis résilient (recréé après `maxRetries`) pour l'indexeur, l'historique LLM et le cache sémantique. | Incident du 2026-08-21 | V3 |
| B9 | Canvas : façade `@aphrody/canvas` 1.0.9-aphrody.2 sur le binaire upstream 1.0.9 (D13) ; sonde native étendue aux cibles préconstruites. | Binaire win32 absent, GLIBC | Déjà livré (`1be3116a`) ; release conditionnée à CI-2 |
| B10 | Fournisseur Discord du bot aligné sur le preset partagé (`prompt: "consent"`, portées dédupliquées, e-mail de substitution). | `better-auth.ts:79` | V3 |
| B11 | Client admin du site validé par le contrat : champs dérivés (`stats`, `services`, `tables`, `table`, `wikiStats`, `economyStats`) lus selon la forme réelle du bot. | Casts `fetch<T>` faux | V4 |
| B12 | Commandes `translate` et `translation` branchées sur le superviseur Bun databooks : Aphrody `ja→fr` prioritaire, replis explicites, lanes déterministes, marqueurs fixes, garde qualité, dépôt PostgreSQL atomique et ingestion RAG idempotente. | L'ancien stub APH-9 ne lançait aucun traitement ; le label BXC n'est pas le backend Aphrody | V4 |
| B13 | Scripts du pipeline sans URL par défaut : erreur explicite nommant la variable manquante. | D16 | V4 |
| B14 | Routes additives : bot `GET /api/public/wiki/categories`, `/api/public/wiki/{category}` et `/{category}/{idOrSlug}` (PostgreSQL, `visible = true`) pour les catégories sans route historique, `/api/public/openapi.json` ; miroir sur le site sous `/api/public/*`. | Contrat utilisé par les outils `dragonball.*` | V4 |
| B15 | Sélecteurs Base UI 1.8 corrigés (accordéon `data-open`/`data-panel-open`, onglets `data-active`). Wrappers inutilisés : aucun changement visible. | Styles jamais appliqués | V2 |
| B16 | Racine de `@shenron/pipeline/aphrody` réduite ; `AphrodyNativeBridge`, `ShenronBridge`, `searchMemory`, `mcpCall` supprimés (0 consommateur). | Pas de FFI dans le bot | V2 |
| B17 | Les personas du bot reçoivent la phrase anti-injection partagée ; `PROMPT_VERSION = 1`. | Garde absente côté bot | V3 |
| B18 | Chemin embed Aphrody du cache sémantique : lots de 16, 384 dimensions vérifiées, espaces réduits. | Aucune de ces gardes aujourd'hui | V3 |

### 2.3 Niveaux de vérification

| Niveau | Contenu | Disponible |
| --- | --- | --- |
| L0 | `bun test`, `app.request` en processus, `.toSQL()` sur `drizzle.mock()`, `fetch` injecté | Oui |
| L1 | tsc 7, oxlint, compilation CSS (postcss + `@tailwindcss/postcss`), `bun build --target=browser`, harnais `Bun.serve` loopback, build Next « compile » optionnel | Oui |
| L2 | Services locaux jetables : les tests lisent seulement `SHENRON_TEST_DATABASE_URL` / `SHENRON_TEST_REDIS_URL`, refusent tout hôte non loopback et toute base dont le nom ne finit pas par `_test`, ne lisent jamais `DATABASE_URL` (le `.env` local contient une URL vivante) | Seulement si l'opérateur les fournit ; sinon ignorés avec raison |
| L3 | CI Linux : `next build`, binaire canvas linux, `aphrody-ci` | Bloqué (`startup_failure` de GitHub Actions, PLAN SH-P0-013) |
| L4 | Production et runbooks opérateur via l'Infra du monorepo | Phase 2+ |

---

## 3. Carte des paquets

La configuration et les opérations du gestionnaire de paquets Bun sont
documentées dans [`BUN-PACKAGE-MANAGER.md`](../../operations/shenron/BUN-PACKAGE-MANAGER.md).

### 3.0 Règles communes

**Manifeste.**

```jsonc
{
  "name": "@shenron/<pkg>", "version": "0.1.0", "private": true, "type": "module",
  "sideEffects": false,                            // ui : ["*.css"]
  "exports": { "./<sub>": "./src/<sub>.ts" },      // sous-chemins explicites ; "." seulement pour une racine héritée
  "shenron": { "runtime": { "./<sub>": "pure" } }, // classe par entrée (tableau ci-dessous)
  "scripts": { "type-check": "tsc --noEmit", "lint": "oxlint", "test": "bun test" },
  "dependencies": { "<npm>": "catalog:", "@shenron/<x>": "workspace:*" },
  "peerDependencies": {},                          // better-auth, hono, next, react selon le paquet
  "devDependencies": { "@types/bun": "catalog:", "typescript": "catalog:" }
}
```

Les agents modifient `exports`, `scripts`, `shenron`, `private` et les champs
de publication de leur paquet ; les blocs de dépendances sont réservés à
l'orchestrateur.

**Presets tsconfig** (créés par l'orchestrateur, figés pendant la vague 1) :

```jsonc
// packages/config/tsconfig/base.json
{ "compilerOptions": { "target": "ESNext", "module": "ESNext", "moduleResolution": "Bundler",
  "moduleDetection": "force", "strict": true, "isolatedModules": true, "skipLibCheck": true,
  "noEmit": true, "resolveJsonModule": true, "verbatimModuleSyntax": false,
  "forceConsistentCasingInFileNames": true, "noFallthroughCasesInSwitch": true } }
// packages/config/tsconfig/bun.json
{ "extends": "./base.json", "compilerOptions": { "types": ["bun"] } }
// packages/config/tsconfig/react.json
{ "extends": "./bun.json", "compilerOptions": { "jsx": "react-jsx", "lib": ["ESNext", "DOM", "DOM.Iterable"] } }
// packages/<pkg>/tsconfig.json
{ "extends": "../config/tsconfig/bun.json", "include": ["src/**/*", "test/**/*", "scripts/**/*"] }
```

**Classes d'exécution.**

| Classe | Peut importer | Interdit |
| --- | --- | --- |
| `pure` | `zod`, bibliothèques sans plateforme (`drizzle-orm`, `ai`, `@ai-sdk/*`), sous-chemins `pure`, globaux `fetch`/`URL`/`AbortSignal`/`crypto.subtle` | `node:*`, `bun`, `bun:*`, `Bun.`, `process`, react, next, hono, `window.`, `document.` |
| `server` | `pure` + `node:*` | `bun`, `bun:*`, react, `next/*`, DOM |
| `hono` | `server` + `hono`, `@hono/*` | comme `server` |
| `react` | `pure` + react, react-dom, `@base-ui/react/*`, `"use client"` | `node:*`, `bun*`, `next/*`, `process` |
| `next` | `server` + `next/*` (importés paresseusement) | `bun*` |
| `bun` | `server` + `hono` + `bun`, `bun:*` sauf `bun:ffi` | react, next |

Règles transverses, contrôlées par `@shenron/config/guards` et
`scripts/audit/shenron/scripts/ops/check-workspace-packages.ts` :

| Règle | Portée |
| --- | --- |
| `server-only`, `@t3-oss/*`, `@/…`, chemins relatifs vers `apps/**`, `tsyringe`, `reflect-metadata`, `@aphrody/*` | interdits dans tout paquet |
| `bun:ffi`, `dlopen`, `@aphrody/bun`, `@aphrody/zstd`, `@aphrody/xml2` | interdits partout (paquets et `apps/shenron/bot`) |
| `process.env`, `Bun.env`, `import.meta.env` au niveau module | interdits ; seule exception : paramètre par défaut `= process.env` dans un fichier `config.ts`, `env.ts` ou `paths.ts` |
| Import à environnement vide | chaque sous-chemin est importé dans un `bun` enfant avec un environnement réduit (`PATH`, plus les variables système Windows) et ne doit pas échouer |
| `import.meta.url` | interdit dans ce qui est atteignable par Next (Turbopack le réécrit) |
| URL, hôte ou port littéral | interdit dans le code neuf hors tests et fixtures |
| Pureté navigateur | `bun build --target=browser` des sous-chemins `pure`/`react` exposés au navigateur : aucune trace `node:` ni `bun:` |

### 3.1 `@shenron/config` (nouveau, feuille)

**Rôle.** Quatre préoccupations transverses sans foyer acyclique aujourd'hui :
presets tsconfig TS7, discipline de lecture d'environnement avec alias de
noms, garde loopback/https unique (4 copies : `compute.ts:66-69`,
`shenron-embeddings.ts:31-39`, `web.ts:33-36`, `ia-cockpit.ts:532-557`) et
doctrine d'IP client, résolveur de chemins mutables, plus le kit de gardes de
portabilité réutilisé par tous les paquets.

| Sous-chemin | Classe |
| --- | --- |
| `./env` | pure |
| `./net` | pure |
| `./paths` | server |
| `./guards` | server (outillage de test et de conformance) |
| `./testing` | pure |
| `./zeni` | pure (formatage monétaire canonique avec espace insécable) |
| `./races` | pure (races XV2, multiplicateurs gains/XP, Zenkai, régénération) |
| `./races-alias` | pure (normalisation des 70 graphies d'import vers les 18 slugs de races canoniques) |
| `./economy-canon` | pure (prix officiels Chōzenshū 4, parité yen/zéni, inflation canon Budokai ×2.96) |
| `./inflation-rules` | pure (élasticité masse monétaire, calcul d'indice et prix indexés arrondis) |
| `./fusion-names` | pure (résolution canonique et mélange syllabique de fusion) |
| `./xp` | pure (paliers de niveaux et calculs d'expérience purs) |
| `./techniques-types` | pure (classification Xenoverse 2 et mentions de provenance) |
| `./tsconfig/{base,bun,react}.json` | json |

```ts
// ./env
export type EnvSource = Readonly<Record<string, string | undefined>>;
export interface EnvIssue { readonly name: string; readonly problem: "missing" | "invalid" | "mismatch" | "deprecated"; readonly hint?: string } // jamais la valeur
export function envString(env: EnvSource, name: string): string | undefined;   // trim ; "", "undefined", "null" → undefined
export function envFirst(env: EnvSource, names: readonly string[]): { name: string; value: string } | undefined;
export function isProduction(env: EnvSource): boolean;                           // NODE_ENV === "production"
export function parseEnv<S extends z.ZodType>(schema: S, env: EnvSource):
  { ok: true; value: z.infer<S> } | { ok: false; issues: readonly EnvIssue[] };
export const ENV_ALIASES: {
  readonly adminToken: readonly ["SHENRON_ADMIN_TOKEN", "API_ADMIN_TOKEN"];
  readonly actingUserSecret: readonly ["SHENRON_USER_SECRET", "API_USER_SECRET"];
  readonly coordDir: readonly ["A2A_COORD_DIR", "COORD_DIR"];
  readonly ragGold: readonly ["RAG_GOLD_PATH", "RAG_GOLD"];
};
export function checkAlias(env: EnvSource, names: readonly string[]): EnvIssue | null; // deux valeurs différentes → "mismatch"

// ./net
export function isLoopbackHost(hostname: string): boolean;   // exactement les formes loopback acceptées aujourd'hui, sans élargir à 127/8
export function parseLoopbackHttpUrl(raw: string | undefined, label: string): { ok: true; url: URL } | { ok: false; issue: EnvIssue }; // http, sans userinfo, sans query ni fragment
export function parseHttpsOrLoopbackUrl(raw: string | undefined, label: string): { ok: true; url: URL } | { ok: false; issue: EnvIssue };
export function clientIpFromHeaders(headers: Headers): string;  // x-real-ip, sinon DERNIER saut XFF, sinon "unknown" (doctrine de apps/site/src/app/api/_client-ip.ts)
export function isDirectLoopback(headers: Headers, remoteAddress: string | null | undefined): boolean; // socket loopback ET ni x-real-ip ni XFF

// ./paths
export type DataPathKey = "ragGold" | "adminDocsDir" | "coordDir" | "databooksFreezeFile" | "ragLexique";
export const DATA_PATH_ENV: Readonly<Record<DataPathKey, readonly string[]>>;
export interface DataPath { key: DataPathKey; path: string; source: "env" | "legacy-default"; envName: string | null }
export function resolveDataPath(key: DataPathKey, ctx: { env: EnvSource; legacyDefault: string }): DataPath;
export function warnIfEphemeral(p: DataPath, env: EnvSource, log: (message: string) => void): void; // une fois par clé et par processus

// ./guards
export type RuntimeClass = "pure" | "server" | "hono" | "react" | "next" | "bun";
export interface Offence { file: string; rule: string; excerpt: string }
export function stripNonCode(source: string): string;
export function checkPackageRuntimes(packageDir: string): Promise<Offence[]>;
export function checkNoEscapingImports(packageDir: string): Promise<Offence[]>;
export function checkEmptyEnvImports(packageDir: string): Promise<Offence[]>;
export function checkBrowserBundles(packageDir: string): Promise<Offence[]>;

// ./testing
export interface RecordedCall { method: string; url: string; headers: Headers; body: string | null }
export function createRecordingFetch(routes: Record<string, (req: Request) => Response | Promise<Response>>):
  { fetch: typeof fetch; calls: RecordedCall[] };
```

Dépendances : `zod` seulement. Interdit : tout paquet `@shenron/*`. Cibles :
serveur et client Next (`./env`, `./net`), bot, scripts.

### 3.2 `@shenron/db`

**Rôle.** PostgreSQL, source de vérité éditoriale : schémas Drizzle, pilotes,
clients bruts, chargement d'URL, dépôts partagés, gel databooks, Redis
résilient. Le SQLite du bot (schéma, `DatabaseService`, `sqlite-vec`) reste
privé à `apps/shenron/bot` (contrat d'infra « SQLite = cache local borné »).

| Sous-chemin | Contenu | Classe |
| --- | --- | --- |
| `<repo>` (héritage) | réexporte `./postgres-js`, `./config` et `schema`, à l'identique | server |
| `./schema`, `./bot-schema` | inchangés (`AGENT_SCOPES` réexporté depuis `./constants`) | pure |
| `./full-schema` | `{ ...schema, ...botSchema }` et le type `FullSchema` | pure |
| `./constants` | zéro dépendance : `AGENT_SCOPES`, `FEEDBACK_STATUSES`, `GOAL_PRIORITIES`, `WIKI_CATEGORIES` | pure |
| `./config` | `resolveDatabaseUrl`, `resolvePoolMax`, `DEFAULT_POOL_MAX`, `POOL_MAX_CEILING`, `isDatabaseConfigured` | pure |
| `./types` | types seulement | pure |
| `./sql` | `createSql` (postgres-js brut) | server |
| `./postgres-js` | `createDb` | server |
| `./bun-sql` (+ alias `./bun`) | `createBunSql`, `createBunDb` | bun |
| `./env` | `loadDatabaseUrl` | server |
| `./wiki-registry` | 21 catégories → table, colonnes | pure |
| `./repos/wiki`, `./repos/agent-keys`, `./repos/accounts` | dépôts en query builder | pure |
| `./guards` | gel databooks | server |
| `./redis` | `createResilientRedis` | bun |
| `packages/shenron/db/scripts/migration-audit.ts` | audit hors ligne ; sonde opérateur en lecture seule | script |

```ts
// ./constants
export const FEEDBACK_STATUSES: readonly ["pending", "gold_added", "rejected", "reviewed"]; // = apps/bot/src/api/ia-cockpit.ts:17
export const GOAL_PRIORITIES: readonly ["p0", "p1", "p2", "p3"];                           // = ia-cockpit.ts:20
export type WikiCategoryName = "characters" | "planets" | "races" | "techniques" | "transformations" | "sagas" | "arcs"
  | "episodes" | "movies" | "games" | "tools" | "battles" | "items" | "dragons" | "wishes" | "locations"
  | "tournaments" | "voice_actors" | "soundtracks" | "power_levels" | "timeline_events";      // identifiants consommés par Aphrody MCP
export const WIKI_CATEGORIES: readonly { readonly name: WikiCategoryName; readonly label: string }[];

// ./config
export function isDatabaseConfigured(env?: EnvSource): boolean;   // garde build/prerender et PostgreSQL nullable du bot

// ./sql, ./postgres-js, ./bun-sql
export interface PgClientOptions {
  url?: string; env?: EnvSource;          // url ?? DATABASE_URL lu à l'appel
  max?: number;                           // défaut resolvePoolMax(DATABASE_POOL_MAX), plafond 20
  applicationName: string;                // obligatoire : un application_name par processus
  idleTimeoutSeconds?: number; connectTimeoutSeconds?: number; prepare?: boolean;   // 30 / 5 / true
}
/** postgres-js brut. JAMAIS passé à drizzle() : les sérialiseurs json/jsonb/date restent intacts. */
export function createSql(o: PgClientOptions): postgres.Sql;
export type ShenronDb = PostgresJsDatabase<typeof schema>;
export function createDb(o: PgClientOptions & { schema?: "public" | "full" }): { db: ShenronDb; client: postgres.Sql };
export type ShenronBunDb = BunSQLDatabase<typeof schema>;
export function createBunSql(o: PgClientOptions & { maxLifetimeSeconds?: number }): SQL;   // application_name, maxLifetime 1800
export function createBunDb(o: PgClientOptions & { schema?: "public" | "full"; maxLifetimeSeconds?: number }): { db: ShenronBunDb; client: SQL };

// ./types
export type ShenronPgDatabase<S extends Record<string, unknown> = FullSchema> = PgDatabase<PgQueryResultHKT, S>;
export type SqlQuery = <T = Record<string, unknown>>(text: string, params?: readonly unknown[]) => Promise<T[]>;

// ./env
/** Environnement d'abord ; dans chaque fichier la DERNIÈRE ligne active gagne ; validé par resolveDatabaseUrl ; valeur jamais journalisée. */
export function loadDatabaseUrl(o?: { env?: EnvSource; varNames?: readonly string[];
  fallbackFiles?: readonly { path: string; varName?: string }[] }):
  { ok: true; url: string; source: { kind: "env"; name: string } | { kind: "file"; path: string; varName: string } }
  | { ok: false; reason: string };

// ./wiki-registry, ./repos/wiki  (visible = true obligatoire ; les 21 tables ont la colonne, vérifié)
export interface WikiCategorySpec { name: WikiCategoryName; label: string; table: PgTable; idColumn: "id";
  slugColumn: string | null; searchColumns: readonly string[]; omitColumns: readonly string[] } // omitColumns contient au moins "visible"
export const WIKI_REGISTRY: Readonly<Record<WikiCategoryName, WikiCategorySpec>>;
export interface WikiCategorySummary { name: WikiCategoryName; label: string; total: number }
export function createWikiReadRepository(db: ShenronPgDatabase<any>): {
  categories(): Promise<WikiCategorySummary[]>;
  list(i: { category: WikiCategoryName; limit: number; offset: number; q?: string }): Promise<{ items: Record<string, unknown>[]; total: number }>;
  get(i: { category: WikiCategoryName; idOrSlug: string }): Promise<Record<string, unknown> | null>; // id numérique, sinon slug si la table en a un
};

// ./repos/agent-keys, ./repos/accounts  (satisfont structurellement AgentKeyStore et DiscordAccountLookup de @shenron/auth)
export function createAgentKeyRepository(db: ShenronPgDatabase<any>): {
  findActiveByHash(hash: string): Promise<AgentKeyRecord | null>; touch(id: string, at: Date): Promise<void>;
  countWritesSince(id: string, since: Date): Promise<number>; recordCall(entry: AgentAuditEntry): Promise<void>;
  /* + opérations d'administration reprises de apps/site/src/lib/agent-keys.ts, même surface */ };
export function createDiscordAccountLookup(db: ShenronPgDatabase<any>): { discordIdForUser(baUserId: string): Promise<string | null> };

// ./guards
export const DATABOOKS_FREEZE_EXIT_CODE = 3;
export type FreezeState = { frozen: false } | { frozen: true; reason: string; path: string | null };
export class DatabooksFrozenError extends Error { readonly code: "DATABOOKS_FROZEN"; readonly freeze: Extract<FreezeState, { frozen: true }> }
/** Synchrone (scripts). Chemin null : gelé en production (S11), libre hors production. Fichier absent : libre.
 *  Fichier contenant {"frozen": false} : libre. Tout autre contenu ou fichier illisible : gelé. */
export function createDatabooksFreezeGate(o: { freezeFile: string | null; production: boolean;
  fs?: { exists(path: string): boolean; read(path: string): string } }): { state(): FreezeState; assertWritable(): void };

// ./redis  (motif de apps/bot/src/workers/indexer.ts ; fabrique injectable pour les tests)
export interface RedisLike { send(command: string, args: string[]): Promise<unknown>; close(): void; readonly connected: boolean }
export interface ResilientRedis extends RedisLike { readonly name: string }
export function createResilientRedis(o: { url: string; name: string; createClient?: (url: string) => RedisLike;
  backoffMs?: readonly number[]; onEvent?: (e: { kind: "connect" | "error" | "recreate"; attempt: number }) => void }): ResilientRedis;
```

Dépendances : `drizzle-orm`, `postgres`, `@paralleldrive/cuid2`,
`@shenron/config`. Interdit : `server-only`, `bun:sqlite`, `better-auth`,
`hono`, `ai`, `react`, `tsyringe`. Invariants conservés : jamais de
`drizzle-kit push` sur le schéma `bot` ; index `bot.*` seulement par
`bot-indexes.sql` ; `prepare: true` et réutilisation du pool par `globalThis`
dans la façade du site ; le bot démarre sans PostgreSQL ; relations v1.

### 3.3 `@shenron/auth`

**Rôle.** Briques Better Auth 1.7.5 indépendantes du framework, gardes
renvoyant un principal, adaptateurs minces.

| Sous-chemin | Contenu | Classe |
| --- | --- | --- |
| `<repo>` (héritage) | `AUTH_BASE_PATH`, `SHENRON_CANONICAL_URL`, `normalizeBaseUrl`, `resolveBetterAuthSecret`, `sharedAdvancedOptions`, `mapDiscordProfileEmail`, `handleAuthRequest`, `getSessionSafe`, `AuthLike`, `BaseSession`, constantes d'origines dépréciées (valeurs de production, S2) | server |
| `./origins` | politique d'hôtes et d'origines par application | pure |
| `./a2a` | décision de garde A2A (D14) | server |
| `./crypto` | comparaison à temps constant, Bearer, SHA-256, HMAC | server |
| `./tokens` | Bearer statique, codec du cookie `dbfr_admin` | server |
| `./acting-user` | protocole `x-acting-*` et vecteur de test partagé | server |
| `./staff` | politique staff | pure |
| `./ports` | `DiscordAccountLookup`, `AgentKeyStore` | pure (types) |
| `./guards` | `Principal`, `authorize`, stratégies | server |
| `./options` | preset Discord, journalisation, cache de cookie, `advanced` | server |
| `./policy` | `decideAccess` | pure |
| `./agent-keys` | format, hachage, portées, quota | server |
| `./next` | en-têtes et requête depuis `next/headers` (import paresseux) | next |
| `./hono` | middleware et montage Better Auth | hono |
| `./client` | `createShenronAuthClient` | react |

```ts
// ./origins, ./a2a
export function siteAllowedHosts(i: { production: boolean }): string[];     // sans "*.vercel.app" ; localhost hors production
export function siteTrustedOrigins(i: { production: boolean }): string[];
export function botTrustedOrigins(i: { production: boolean }): string[];
export function a2aEnforced(env: EnvSource): boolean;                        // SHENRON_A2A_ENFORCE ∈ {"1", "true"}
export type A2AWriteDecision = { ok: true; authenticated: boolean }
  | { ok: false; status: 401 | 503; code: "a2a_unauthorized" | "a2a_not_configured" };
export function decideA2AWrite(headers: Headers, o: { token: string | undefined; enforce: boolean }): A2AWriteDecision;

// ./crypto, ./tokens, ./acting-user  (node:crypto, synchrone)
export function timingSafeEqualString(a: string, b: string): boolean;        // remplace 7 copies
export function parseBearer(headers: Headers, o?: { caseSensitive?: boolean }): string | null; // bot : préfixe exact conservé
export function sha256Hex(input: string): string;
export function hmacSha256Hex(secret: string, message: string): string;
export function verifyStaticBearer(headers: Headers, accepted: readonly (string | null | undefined)[],
  o?: { minLength?: number; caseSensitive?: boolean }): "absent" | "valid" | "invalid" | "not_configured"; // minLength 16
export const ADMIN_COOKIE = "dbfr_admin";
export interface AdminCookieCodec { readonly maxAgeSeconds: number; sign(nowMs?: number): string; verify(value: string | null | undefined, nowMs?: number): boolean }
/** Format existant, octet pour octet : `${exp}.${hex(HMAC(secret, "admin:" + exp + ":" + sha256(token).slice(0, 16)))}`. */
export function createAdminCookieCodec(o: { secret: string; masterToken: string; ttlMs?: number }): AdminCookieCodec;
export const ACTING_USER_HEADERS: { readonly user: "x-acting-user"; readonly ts: "x-acting-ts"; readonly sig: "x-acting-sig" };
export function signActingUser(o: { secret: string; discordId: string; nowMs?: number }): Record<string, string>;
export type ActingUserResult = { ok: true; discordId: string } | { ok: false; code: "not_configured" | "missing" | "bad_id" | "skew" | "bad_sig" };
export function verifyActingUser(headers: Headers, o: { secret: string | null | undefined; nowMs?: number; skewMs?: number }): ActingUserResult;
export const ACTING_USER_TEST_VECTOR: { readonly secret: string; readonly discordId: string; readonly ts: string; readonly sig: string };

// ./staff, ./ports
export function parseSnowflakeCsv(raw: string | undefined): string[];
export interface StaffPolicy { readonly ids: ReadonlySet<string>; isStaff(discordId: string | null | undefined): boolean }
export function createStaffPolicy(i: { ownerIds?: readonly string[]; devIds?: readonly string[]; allowedUsers?: readonly string[] }): StaffPolicy;
export function staffPolicyFromEnv(env: EnvSource, scope: "bot" | "site"): StaffPolicy;   // D6 : périmètres distincts
export interface DiscordAccountLookup { discordIdForUser(baUserId: string): Promise<string | null> }
export interface AgentKeyRecord { id: string; name: string; scopes: readonly string[]; revokedAt: Date | null; rateLimit: number }
export interface AgentKeyStore { findActiveByHash(hash: string): Promise<AgentKeyRecord | null>; touch(id: string, at: Date): Promise<void>;
  countWritesSince(id: string, since: Date): Promise<number>; recordCall(entry: AgentAuditEntry): Promise<void> }

// ./guards
export type Principal =
  | { kind: "user"; userId: string; discordId: string | null; staff: boolean; via: "better-auth" | "legacy-session" }
  | { kind: "admin-token"; via: "bearer" | "admin-cookie" | "legacy-session" }
  | { kind: "agent"; keyId: string; scopes: readonly string[] }
  | { kind: "acting-user"; discordId: string }
  | { kind: "service"; name: string };
export type AuthErrorCode = "unauthenticated" | "invalid_token" | "forbidden" | "scope_missing" | "not_configured" | "cross_origin";
export type AuthDecision = { ok: true; principal: Principal } | { ok: false; status: 401 | 403 | 404 | 503; code: AuthErrorCode };
export type Strategy = (request: Request) => Promise<AuthDecision | null>;   // null = non applicable, stratégie suivante
export function authorize(request: Request, strategies: readonly Strategy[]): Promise<AuthDecision>;
export function staticBearerStrategy(o: { tokens: () => readonly (string | null | undefined)[]; as: Principal;
  wrongBearerIsFinal: boolean; unsetIs503: boolean; caseSensitive?: boolean }): Strategy;
export function adminCookieStrategy(o: { codec: () => AdminCookieCodec | null }): Strategy;
export function sessionStrategy(o: { getSession(headers: Headers): Promise<{ user: { id: string } } | null>;
  accounts: DiscordAccountLookup; staff: StaffPolicy; requireStaff: boolean }): Strategy;     // non-staff → 403
export function legacySessionStrategy(o: { verify(request: Request): Promise<{ source: "token" | "discord"; userId?: string } | null>; staff: StaffPolicy }): Strategy;
export function actingUserStrategy(o: { secret: () => string | null | undefined }): Strategy;
export function agentKeyStrategy(o: { store: AgentKeyStore; now?: () => Date }): Strategy;
export function requireScope(d: AuthDecision, scope: string): AuthDecision;
export function assertSameOrigin(request: Request, allowedOrigins: readonly string[]): AuthDecision | null;

// ./options, ./policy, ./agent-keys
export function discordProvider(o: { clientId: string; clientSecret: string; extraScopes?: readonly string[] }): DiscordProviderOptions;
  // prompt "consent" ; identify/email retirés des extras ; mapProfileToUser → e-mail de substitution octet-stable
export function loggingOptions(nodeEnv: string | undefined): { logger: { level: "warn" | "debug" } };
export function drizzleDebugLogs(nodeEnv: string | undefined): boolean;
export const SESSION_COOKIE_CACHE: { readonly enabled: true; readonly maxAge: 300 };
export function advancedOptions(o: { production: boolean; cookiePrefix?: string; trustedProxies?: readonly string[] }): NonNullable<BetterAuthOptions["advanced"]>;
export function decideAccess(rule: AccessRule, v: Visitor, o: { emptyRoles: "members" | "deny" }): "allow" | "deny-anonymous" | "deny";
export const AGENT_TOKEN_PREFIX = "dbfr_agent_";
export function generateAgentToken(): { token: string; hash: string; displayPrefix: string };
export function hashAgentToken(token: string): string;
export function parseScopes<S extends string>(vocabulary: readonly S[], raw: unknown): S[] | null;  // vocabulaire injecté (AGENT_SCOPES)
export function hasScope(scopes: readonly string[], needed: string): boolean;
export function decideWriteQuota(i: { method: string; writesLastHour: number; limit: number }): { allowed: boolean; retryAfterSeconds?: number };

// ./next, ./hono, ./client
export function requestHeaders(): Promise<Headers>;
export function authorizeNext(strategies: readonly Strategy[]): Promise<AuthDecision>;
export function authMiddleware(strategies: readonly Strategy[], o?: { require?: (d: AuthDecision) => AuthDecision;
  deny?: (d: Extract<AuthDecision, { ok: false }>) => Response }): MiddlewareHandler<{ Variables: { principal: Principal } }>;
export function mountBetterAuth(app: Hono<any>, auth: AuthLike, basePath?: string): void;
export function createShenronAuthClient(o: { fallbackURL: string }): ReturnType<typeof createAuthClient>;
```

Dépendances : `@shenron/config`. Pairs : `better-auth` (passe de dépendance à
pair), `hono`, `next`, `react` optionnels. `@shenron/db` n'est qu'une
dépendance de développement (tests de conformance). Interdit : `server-only`,
`@/lib/env`, lecture d'environnement au chargement, secret de substitution,
JWT fait main. Invariants : secret ≥ 32 caractères et fermé en production,
`prompt: "consent"` et e-mail de substitution octet-stables, cache de cookie
300 s, `roleAdmin` hors de la session, journalisation `warn` en production,
en-têtes d'IP crus seulement depuis un proxy loopback, préfixe de cookie du
bot `shenron_ba`, format et durée du cookie `dbfr_admin` inchangés. Livrés
en Phase 1 avec tests, `./hono` et `authorizeNext` attendent leur premier
consommateur de groupe admin (SH-API-2).

### 3.4 `@shenron/pipeline/ai`

**Rôle.** Abstraction IA en TypeScript sur AI SDK v7 (spécification v4) :
client typé des routes `/api/v1/shenron/*` d'`aphrody-ai-http`, modèles AI
SDK, doctrine éditoriale (personas, ancrage, garde anti-injection),
génération ancrée derrière des ports, métriques d'évaluation. Tout calcul
lourd reste chez Aphrody.

| Sous-chemin | Contenu | Classe |
| --- | --- | --- |
| `<repo>` | constantes et types (`SHENRON_E5`, `PROMPT_VERSION`) | pure |
| `./config` | `resolveAiConfig` | pure |
| `./wire` | miroirs zod de `aphrody-ai/crates/aphrody-mcp/src/http_rest.rs` et `APHRODY_LIMITS` | pure |
| `./aphrody` | `createAphrodyCompute` | pure |
| `./embeddings` | modèles E5 et aides du chemin chaud | pure |
| `./chat` | `createAphrodyChatModel` | pure |
| `./provider` | `createShenronProvider` | pure |
| `./prompts` | personas, ancrage, garde, bloc de sources | pure |
| `./generate` | `generateGroundedAnswer` | pure |
| `./eval` | jeu d'or, Recall@k, MRR, nDCG | pure |
| `./ports` | ports de stockage | pure |

```ts
// ./config  (aucune URL par défaut)
export const SHENRON_E5: { readonly modelId: "Xenova/multilingual-e5-small"; readonly dimensions: 384; readonly maxInputs: 16; readonly maxChars: 8192 };
export type AphrodyChatModelId = "gemini-web/flash" | "gemini-web/flash-lite" | "gemini-web/pro" | (string & {});   // ≤ 128 caractères
export interface AiConfig {
  compute: { baseUrl: URL; token: string } | null;             // APHRODY_AI_HTTP_URL (loopback, alias APHRODY_SHENRON_API_URL) + APHRODY_AI_HTTP_TOKEN (≥ 32, alias APHRODY_SHENRON_API_TOKEN)
  embed: { transport: "aphrody" } | { transport: "e5-direct"; baseUrl: URL } | null; // D10 : choix par configuration
  e5BaseUrl: URL | null;                                        // APHRODY_AI_EMBED_BASE_URL puis alias (base, origin, endpoint)
  embedSpace: { model: string; dimensions: number };            // APHRODY_AI_EMBED_MODEL / _DIMENSIONS, défaut index shenron-rag (E5, 384)
  rerank: { endpoint: URL; dialect: "llama-server" | "shenron-sidecar"; model?: string; source: string } | null;
  chatModel: AphrodyChatModelId;                                // APHRODY_AI_CHAT_MODEL puis APHRODY_LLM_MODEL, défaut "gemini-web/flash" (identifiant, pas une adresse)
  visionModel: string;                                          // APHRODY_AI_VISION_MODEL, défaut "gemini-web/flash"
  ragBackend: "aphrody" | "local";                              // RAG_BACKEND, "aphrody" seulement sur égalité exacte
  timeouts: { health: number; embedHot: number; embed: number; chat: number; chatGeminiWeb: number; ocr: number }; // 3000 / EMBED_TIMEOUT_MS ?? 3000 / 10000 / 90000 / 125000 / 280000
  disabled: readonly { capability: "compute" | "chat" | "embed" | "ocr" | "rag"; reason: string }[]; // noms seulement
}
export function resolveAiConfig(env: EnvSource): { ok: true; config: AiConfig } | { ok: false; issues: readonly EnvIssue[] };

// ./aphrody
export type AiFailure =
  | { ok: false; kind: "not_configured"; detail: string }
  | { ok: false; kind: "unreachable" | "timeout"; path: string; detail: string }
  | { ok: false; kind: "http"; path: string; status: number; detail: string; retryAfterSeconds?: number }
  | { ok: false; kind: "invalid_json" | "invalid_response"; path: string; detail: string };
export type AiResult<T> = { ok: true; value: T } | AiFailure;
export interface AphrodyCompute {
  health(): Promise<AiResult<{ rag: boolean; llm: boolean; ocr: boolean }>>;
  chat(i: { messages: readonly { role: "system" | "user" | "assistant"; content: string }[]; model?: string; signal?: AbortSignal }): Promise<AiResult<{ answer: string; model: string }>>;
  embed(i: { texts: readonly string[]; kind: "query" | "passage"; signal?: AbortSignal }): Promise<AiResult<{ vectors: number[][] }>>; // sans préfixe client, lots de 16
  ragSearch(q: { q: string; limit?: number; lang?: string; kind?: string; sourceId?: string; entity?: string }): Promise<AiResult<{ results: AphrodyRagHit[]; mode: "lexical" | "hybrid" | "hybrid+rerank" }>>;
  ragDocument(sourceId: string): Promise<AiResult<AphrodyRagDocument | null>>;
  ragStats(): Promise<AiResult<AphrodyRagStats>>;
  ragIngest(doc: AphrodyIngestDoc): Promise<AiResult<{ indexed: true; sourceId: string; vectorIndexed: boolean }>>;
  ragSyncFinish(i: { originSourceId: string; syncGeneration: string; expectedCount: number }): Promise<AiResult<{ retired: number }>>;
  ocr(i: { imageBase64: string; engine?: "ppocr" | "gemini-web" | "vlm"; language?: string; includeGeometry?: boolean }): Promise<AiResult<AphrodyOcrResult>>; // engine défaut "ppocr"
  visionStructured(i: { imageBase64: string; mime: string; prompt: string; model?: string }): Promise<AiResult<{ result: unknown; model: string }>>;
}
/** redirect "error" ; Bearer ; fetch résolu à chaque appel ; délai par appel ; jamais de jeton dans detail ; ne se fie jamais à health().ocr. */
export function createAphrodyCompute(cfg: NonNullable<AiConfig["compute"]>, o?: { fetch?: typeof fetch; timeouts?: Partial<AiConfig["timeouts"]> }): AphrodyCompute;

// ./embeddings
export function aphrodyEmbeddingModel(compute: AphrodyCompute, kind: "query" | "passage"): EmbeddingModelV4;   // aucun préfixe côté client
export function e5DirectEmbeddingModel(e5: { baseUrl: URL }, kind: "query" | "passage", o?: { fetch?: typeof fetch }): EmbeddingModelV4;
  // wrapEmbeddingModel(createOpenAICompatible({ name: "shenron-e5", baseURL, fetch }).embeddingModel(SHENRON_E5.modelId), e5Middleware(kind))
export function e5Middleware(kind: "query" | "passage"): EmbeddingModelV4Middleware;
  // transformParams : `${kind}: ` + réduction \s+ + trim, vide refusé ; 16 par appel ; appels non parallèles ;
  // wrapEmbed : nombre, index (unicité et ordre, depuis response.body), 384 dimensions, valeurs finies
export function selectEmbeddingModel(cfg: AiConfig, kind: "query" | "passage", deps: { compute: AphrodyCompute | null; fetch?: typeof fetch }): EmbeddingModelV4 | null;
export function embedQuery(model: EmbeddingModelV4, text: string, o: { timeoutMs: number; signal?: AbortSignal }): Promise<AiResult<number[]>>;          // maxRetries 0
export function embedPassages(model: EmbeddingModelV4, texts: readonly string[], o: { timeoutMs: number }): Promise<AiResult<number[][]>>;        // maxParallelCalls 1

// ./chat, ./provider
export function createAphrodyChatModel(compute: AphrodyCompute, o: { modelId: AphrodyChatModelId }): LanguageModelV4;
  // specificationVersion "v4", provider "aphrody.shenron", supportedUrls {} ; instructions → message system en tête ;
  // outils, fichiers, images → UnsupportedFunctionalityError ; ≤ 32 messages de ≤ 32 Kio ; délai 125 s pour gemini-web/*, 90 s sinon ;
  // finishReason { unified: "stop" } ; usage vide ; doStream = un seul fragment texte
export function createShenronProvider(cfg: AiConfig, deps: { compute: AphrodyCompute | null; fetch?: typeof fetch }): Provider;
  // customProvider : languageModels chat, chat-flash-lite, chat-pro ; embeddingModels e5-query, e5-passage

// ./prompts
export type PersonaId = "whis" | "beerus" | "shenron" | "grandpretre" | "kaio" | "enma";   // clés réelles de PERSONA_SYSTEM (llm.ts)
export const DEFAULT_PERSONA: "whis";
export function resolvePersona(id: string): PersonaId;          // même normalisation que persona() de llm.ts
export const PERSONAS: Readonly<Record<PersonaId, { instructions: string; fallback: string }>>;  // textes recopiés à l'identique
export const PROMPT_VERSION: string;
export const INJECTION_GUARD: string;                           // phrase unique, bot et site
export function buildGroundingInstructions(persona: PersonaId, voice?: "site-short" | "site-long"): string;
export function buildSourcesBlock(hits: readonly { title: string; url: string; text: string }[], limits: { perHit: number; total: number }): string;
export function isChitchat(text: string): boolean;

// ./ports, ./generate
export interface ChunkContentPort { contentFor(hitIds: readonly string[]): Promise<ReadonlyMap<string, string>> } // bot : rag_chunks SQLite ; Aphrody : hit.content
export interface HistoryPort { load(sessionId: string, turns: number): Promise<readonly { role: "user" | "assistant"; content: string }[]>; append(sessionId: string, turn: { q: string; a: string }): Promise<void> }
export interface SemanticCachePort { lookup(scope: string, question: string): Promise<string | null>; store(scope: string, question: string, answer: string): Promise<void> }
export interface ConcurrencyPort { run<T>(fn: () => Promise<T>): Promise<T | "busy"> }
export function semanticCacheScope(modelId: string, context: string): Promise<string>;   // sha256 WebCrypto(model \0 PROMPT_VERSION \0 context)
export function generateGroundedAnswer(i: { model: LanguageModelV4; persona: PersonaId; question: string;
  hits: readonly { id: string; title: string; url: string }[]; chunks: ChunkContentPort;
  history?: HistoryPort; cache?: SemanticCachePort; concurrency?: ConcurrencyPort; sessionId?: string; abortSignal?: AbortSignal
}): Promise<{ answer: string; fallback: boolean; cached: boolean; promptVersion: string }>;
  // generateText({ model, instructions, messages (user/assistant), maxRetries: 0 }) ; replis jamais mis en cache ; tours de session jamais mis en cache

// ./eval  (bit à bit avec apps/bot/src/lib/rag-eval.ts)
export interface GoldCase { q: string; expect: readonly string[]; lang?: string; tags?: readonly string[] }
export function parseGold(text: string): GoldCase[];
export function normalizeUrl(u: string): string;
export function matchesExpectedUrl(hitUrl: string, expected: string): boolean;
export function recallAtK(ranked: readonly string[], expected: readonly string[], k: number): number;
export function mrr(ranked: readonly string[], expected: readonly string[]): number;
export function ndcgAtK(ranked: readonly string[], expected: readonly string[], k: number): number;
```

Dépendances : `ai`, `@ai-sdk/openai-compatible`, `@ai-sdk/provider`
(4.0.17, déjà verrouillé), `zod`, `@shenron/config`. Interdit : `bun:*`,
`node:*`, `@shenron/pipeline/aphrody`, `@shenron/db`, Redis, `sqlite-vec`,
`@huggingface/transformers`. `packages/shenron/pipeline/scripts/ai/check-contracts.ts` compare
les miroirs `./wire` et leurs fixtures (chaque fixture cite sa ligne source)
au fichier `../aphrody-ai/crates/aphrody-mcp/src/http_rest.rs` quand le dépôt
voisin est présent, et s'ignore avec une raison sinon. Cibles : serveur Next,
bot, scripts ; jamais le paquet client.

### 3.5 `@shenron/pipeline/aphrody`

**Rôle.** Connecteurs Aphrody hérités, source seule : façades de
compatibilité des clients de calcul (qui délèguent à `@shenron/pipeline/ai` à partir
de la vague 3), client Web (`aphrody-web-api`), hub A2A, lancement de la CLI.

| Sous-chemin | Contenu | Classe | Importateurs autorisés |
| --- | --- | --- | --- |
| `<repo>` | `AphrodyComputeClient`, `ShenronEmbeddingsClient`, `SHENRON_EMBED_MODEL`, `SHENRON_EMBED_DIMENSIONS`, `AphrodyWebClient` et leurs types | server | tous (héritage) |
| `./compute`, `./embeddings` | mêmes classes ; façades sur `@shenron/pipeline/ai` : exceptions, signatures, option `fetcher`, défaut d'URL hérité (retiré par INFRA-3), `fetch` résolu à l'appel | server | héritage |
| `./web` | `AphrodyWebClient` | server | scripts, site |
| `./a2a` | `ShenronA2AHub`, sondes | server (Bun via global, sans import statique) | routes A2A du site |
| `./cli` | `runAphrodyCli`, `aphrodyDoctor`, `aphrodyGitInspect` | bun | scripts uniquement |

```ts
// ./a2a
export interface AdminNotifier { send(message: { channelId: string; content?: string; embeds?: unknown[] }): Promise<unknown> }
export class ShenronA2AHub {                        // entièrement statique, API existante inchangée
  static configure(o: { notifier?: AdminNotifier | null; coordDir?: string | null }): void;  // notificateur absent : avertissement unique, pas d'envoi
  static setProbes(overrides: Partial<A2AProbes>): void;
  static resetProbes(): void;
  /* getAgentCard, sendMessage, updateTask, getTask, listTasks, listEnvelopes, handleMsgEnvelope, handleJsonRpc… */
}
// ./cli
export type CliResult<T> = { ok: true; value: T } | { ok: false; kind: "not_found" | "exit" | "timeout" | "invalid_json"; detail: string };
export function runAphrodyCli(args: readonly string[], o: { bin: string; timeoutMs: number; json?: boolean }): Promise<CliResult<{ exitCode: number; stdout: string; json?: unknown }>>;
export function aphrodyDoctor(o: { bin: string; timeoutMs?: number }): Promise<CliResult<AphrodyDoctorResult>>;           // doctor --json
export function aphrodyGitInspect(o: { bin: string; path: string; timeoutMs?: number }): Promise<CliResult<AphrodyGitResult>>;
// pas d'enveloppe pour translate ni notify : leur sortie n'est pas du JSON
```

Dépendances : `@shenron/config`, `@shenron/pipeline/ai` (façades, vague 3),
`@shenron/db` (`./env`, pour les sondes A2A). `sharp` quitte le paquet avec
`measureInkStroke` (`@shenron/images/ink-stroke`). Interdit : `bun:ffi`,
`bun:sqlite` statique, l'import relatif de `apps/bot/src/lib/admin-lab` (not in repo)
(`a2a.ts:22`). Les défauts littéraux des sondes A2A restent jusqu'au retrait
du hub TypeScript (ticket SH-A2A).

### 3.6 `@shenron/api`

**Rôle.** Contrat HTTP (zod), client typé sans exception, aides HTTP pures et
fabrique d'application OpenAPIHono à ports injectés, montée dans `shenron-bot`
et `shenron-site`. Pas de racine `<repo>` : un import côté navigateur ne peut pas
tirer le serveur.

| Sous-chemin | Contenu | Importe hono ? | Classe |
| --- | --- | --- | --- |
| `./contract` | schémas zod + `.meta({ id })`, `ENDPOINTS`, `LEGACY_PUBLIC_PATHS` | non | pure |
| `./client` | `createShenronApiClient` | non | pure |
| `./http` | cache public (TTL, LRU 256, ETag FNV, 304, `s-maxage=2x`, `stale-while-revalidate=4x`), CORS, limiteur mémoire, port d'invalidation | non | pure |
| `./server` | `createShenronApi`, `WikiReadPort` | oui | hono |
| `./next` | `toNextRouteHandlers`, `nextInvalidationPort` (fonctions Next injectées, aucun import de Next) | oui (types) | server |
| `./openapi.json` | `openapi/public.json` généré, commité, vérifié par `--check` | — | json |

```ts
// ./contract
export const ApiErrorCode: z.ZodEnum<["not_found", "invalid_request", "rate_limited", "unauthenticated", "forbidden", "pg_unavailable", "upstream_unavailable", "internal"]>;
export const ErrorEnvelope;          // { error: string; code?: ApiErrorCode; message?: string } — compatible { "error": "Not found" }
export const HealthResponse, PublicStats, RagSearchQuery, RagHit, RagSearchResponse, RagContextResponse;            // formes actuelles du bot
export const CreateGoalBody, CompleteGoalBody, FeedbackStatusBody, GoldCaseBody, EvalRequestBody;                   // limites du bot (titre ≤ 200, description ≤ 4000)
export const TablePage: <T extends z.ZodType>(row: T) => z.ZodObject<{ rows: z.ZodArray<T>; total: z.ZodNumber; limit: z.ZodNumber; offset: z.ZodNumber }>;
export const WikiCategoryName, WikiCategorySummary /* { name, label, total } */, WikiCategoriesResponse /* { categories } */;
export const WikiListQuery /* limit 1..200 défaut 50, offset ≥ 0, q ≤ 200 */, WikiListResponse /* { category, items, total, limit, offset } */, WikiEntity;
export const BotAdminStats /* { stats: { totalUsers, totalGuilds, totalActiveUsers, totalCommands } } */, BotServices /* { actions } */,
  BotTables, BotTableRows, BotWikiStats /* { counts, isSeeded } */, BotEconomyStats;
export interface EndpointSpec { id: string; method: "get" | "post"; path: `/${string}`; auth: "public" | "admin" | "acting-user";
  query?: z.ZodType; body?: z.ZodType; response: z.ZodType; cache?: { maxAgeSeconds: number } | "no-store" }
export const ENDPOINTS: readonly EndpointSpec[];   // chemins complets, pas de basePath imbriqué (honojs/middleware#952)
export const LEGACY_PUBLIC_PATHS: readonly string[];

// ./client
export type ApiFailure =
  | { ok: false; kind: "unreachable" | "timeout"; path: string; detail: string }
  | { ok: false; kind: "http"; path: string; status: number; detail: string; error?: z.infer<typeof ErrorEnvelope> }
  | { ok: false; kind: "invalid_json" | "invalid_response"; path: string; detail: string; issues?: readonly string[] };
export type ApiResult<T> = { ok: true; value: T; status: number; etag?: string } | ApiFailure;
export interface ShenronApiClientOptions { baseUrl: string | URL; fetch?: typeof fetch; timeoutMs?: number;
  adminToken?: () => string | null;                                       // appelants serveur seulement
  signActingUser?: (discordId: string) => Record<string, string>;          // injecté : ./client reste pur
  userAgent?: string }
export function createShenronApiClient(o: ShenronApiClientOptions): {
  call<E extends EndpointSpec>(endpoint: E, input: EndpointInput<E>): Promise<ApiResult<EndpointOutput<E>>>;
  wiki: { categories(); list(category, query?); get(category, idOrSlug) };
  rag: { search(q); context(q) };
  cockpit: { createGoal(b); completeGoal(id, b); setFeedbackStatus(id, b); addGold(b); runEval(b) };
  admin: { stats(); services(); tables(); table(name, page); wikiStats(); economyStats() };
};

// ./http
export interface RateLimitPort { hit(key: string, o: { limit: number; windowMs: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }> }
export interface PublicCachePort { get(key: string): { body: string; etag: string; storedAt: number } | null; set(key: string, body: string, ttlMs: number): { etag: string } }
export interface InvalidationPort { paths(p: readonly string[]): Promise<void>; tags(t: readonly string[]): Promise<void> }
export function createMemoryRateLimiter(o?: { now?: () => number }): RateLimitPort;
export function createPublicCache(o?: { maxEntries?: number }): PublicCachePort;   // 256
export function fnvEtag(body: string): string;                                     // vecteurs = server.ts
export function publicCacheHeaders(ttlSeconds: number): Record<string, string>;
export function corsHeaders(origin: string | null, allowlist: readonly string[], methods: readonly string[]): Record<string, string>;
export const noopInvalidation: InvalidationPort;

// ./server
export interface WikiReadPort {                       // déclaré ici, implémenté par createWikiReadRepository (@shenron/db)
  categories(): Promise<{ name: string; label: string; total: number }[]>;
  list(i: { category: string; limit: number; offset: number; q?: string }): Promise<{ items: Record<string, unknown>[]; total: number }>;
  get(i: { category: string; idOrSlug: string }): Promise<Record<string, unknown> | null>;
}
export interface ShenronApiPorts {
  wiki?: WikiReadPort | null;                         // absent → groupe désactivé → handles() faux → 404 historique
  rateLimit: RateLimitPort; publicCache: PublicCachePort; invalidation: InvalidationPort;
  cors: { allowedOrigins: readonly string[] };
  clientIp(request: Request): string; isDirectLoopback(request: Request): boolean;
  log?(event: { event: string; path: string; status?: number; ms?: number }): void;   // jamais d'en-têtes ni de corps
}
export interface ShenronApi { readonly app: OpenAPIHono; fetch(request: Request): Promise<Response>; handles(pathname: string): boolean; openApiDocument(): object }
export function createShenronApi(ports: ShenronApiPorts, o: { service: "shenron-bot" | "shenron-site" }): ShenronApi;
  // GET/HEAD/OPTIONS ; autres méthodes et chemins inconnus → { "error": "Not found" } 404 ; erreurs → 500 générique ;
  // /api/public/wiki/categories enregistrée avant /{category} ; données PostgreSQL indisponibles → 503 { error, code: "pg_unavailable" }

// ./next
export function toNextRouteHandlers(api: ShenronApi): { GET(r: Request): Promise<Response>; HEAD(r: Request): Promise<Response>; OPTIONS(r: Request): Promise<Response> };
export function nextInvalidationPort(fns: { revalidatePath(p: string): void; revalidateTag(t: string): void }): InvalidationPort;
```

Dépendances : `hono`, `@hono/zod-openapi`, `zod`, `@shenron/config`,
`@shenron/db` (`./constants`, `./repos/wiki` pour les types et la
conformance), `@shenron/auth` (`./hono`, réservé aux groupes admin de la
Phase 2). La dépendance déclarée vers `@shenron/pipeline/ai` est retirée : l'IA
atteindra l'API par un `RagPort`, ce qui garde le graphe acyclique. Interdit :
`tsyringe`, `@discordx/di`, `container.resolve`, `server-only`, `next/*`,
`discord.js`, messages français codés dans les codes d'erreur.

### 3.7 `@shenron/ui`

**Rôle.** Primitives Base UI 1.8 + Tailwind v4, SVG et couche visuelle portable
partagées par le site et le tableau de bord du bot. Le paquet n'importe aucun
module de l'application Shenron ou de Next.js ; son `README.md` décrit les
entrées publiques et les adaptateurs.

| Sous-chemin | Contenu | Classe | Vague |
| --- | --- | --- | --- |
| `<repo>` | barrel sûr côté serveur : `cn`, `pageWindow`, constantes de jetons, aucun composant | pure | 1 |
| `./lib/utils` | `cn` seul | pure | 1 |
| `./lib/page-window` | `pageWindow` (+ alias `pagesVisibles`, `pagerWindow`) | pure | 1 |
| `./styles.css` | blocs `@theme inline`, miroirs `:root` (sans `--shell-*`), `.cible-44`, `.card/.btn/.input/.badge` en `@layer components` | css | 1 |
| `./tokens` | généré depuis `styles.css`, test de dérive | pure | 1 |
| `./*` | wrappers Base UI (`src/components/*.tsx`, `"use client"` si nécessaire) | react | 2 |
| `./icones` | glyphes maison | react | 3 |
| `./server`, `./client` | vues React sans service hôte, séparées par frontière de rendu | react | actuelle |
| `./public`, `./admin`, `./layout/*`, `./navigation/*` | présentations, cadres et liens injectables | react | actuelle |
| `./toriyama`, `./svg`, `./cinematic` | dessins et effets Dragon Ball | react/pure | actuelle |
| `./site.css`, `./toriyama.css`, `./barre-nav.css`, `./editor.css`, `./editorial.css`, `./assets/*` | CSS du site et 24 actifs d'interface | css/asset | actuelle |

```ts
export function cn(...inputs: ClassValue[]): string;
export function pageWindow(current: number, total: number): Array<number | "…">;   // sortie identique à Pagination.pagesVisibles et LinkPager.pagerWindow
export const tokens: { readonly color: Readonly<Record<string, string>>; readonly radius: Readonly<Record<string, string>>;
  readonly font: Readonly<Record<string, string>>; readonly ember: { readonly css: string; readonly siteThemeDefault: string } };  // les deux valeurs d'ember, figées (OWN-7)
export function Pagination(p: { page: number; total: number; locale: string;
  labels: { previous: string; next: string; range: string; unit: string } /* défauts = textes français actuels */ }): JSX.Element;
```

Dépendances : `@base-ui/react`, `@tanstack/react-query`,
`class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` ; pairs
`react`, `react-dom`. Interdit :
`next/*`, next-intl, `@/…`, lecture d'environnement et tout paquet
`@shenron/*` dans le runtime. Les illustrations livrées sont des SVG du paquet ;
les chaînes de présentation historiques ne sont pas une source de données.
Les wrappers
passent en sous-chemins Base UI (`@base-ui/react/<partie>`) ; accordéon et
onglets reçoivent les sélecteurs 1.8. Les vues métier et les contrôles d'accès
restent dans les applications ; les éléments visuels Toriyama sont dans le paquet.

### 3.8 Paquets consommateurs

- `@shenron/images` : déjà en source ; reçoit `./ink-stroke`, et porte le manifeste de dédup
  bot/site `src/asset-aliases.json` (résolution `./resolve`, consommée par
  `apps/shenron/bot/src/lib/asset-files.ts` et les redirections Next du site).
- `@shenron/pipeline` regroupe les clients IA et Aphrody, le pont BXC et les
  scripts de workflows. Les modules restent séparés par sous-chemin public et
  sont livrés via le même workspace.
- `@aphrody/*` vendorisés : `dist` commité, hors du périmètre.
- Schéma SQLite du bot, `DatabaseService`.

---

## 4. Graphe de dépendances

### 4.1 Paquet vers paquet (acyclique)

```
                        @shenron/config (zod)
            ┌──────────────┬──────┴───────┬──────────────┐
            ▼              ▼              ▼              │
       @shenron/db    @shenron/auth   @shenron/pipeline/ai        │
        ▲   ▲   ▲     (⇢ db : dev)        ▲              │
        │   │   └──────────────┐          │              │
        │   │                  │          │              │
        │   └── @shenron/api ──┼─► auth   │              │
        │       (→ config, db, auth)      │              │
        └────── @shenron/pipeline/aphrody ─────────┘──────────────┘
                (→ config, ai, db/env)

  @shenron/ui : aucune arête @shenron/* (presets par chemin relatif)
```

| De → Vers | Autorisé | Motif |
| --- | --- | --- |
| `db → config` | oui | env, chemins |
| `auth → config` | oui | env, net |
| `auth ⇢ db` | dépendance de développement seulement | tests de conformance des ports |
| `ai → config` | oui | garde loopback, env |
| `aphrody → config, ai, db` | oui (`db` : `./env` seulement) | façades de calcul, sondes A2A |
| `api → config, db, auth` | oui | constantes, types des dépôts, middleware futur |
| `ui → *` | non | UI pure |
| `ai → aphrody/db/api`, `api → ai`, `db → auth/ai/api`, `auth → db` (exécution), `auth → api`, `config → *` | **interdit** | cycle ou inversion de couches |

### 4.2 Applications vers paquets

| Consommateur | config | db | auth | aphrody | ai | api | ui |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `apps/shenron/site` (serveur, `bun --bun next`) | oui | `<repo>`, `./postgres-js`, `./schema`, `./bot-schema`, `./guards`, `./repos/*`, `./constants` | tout sauf `./hono` | `<repo>`, `./a2a` ; jamais `./cli` | oui (serveur) | `./contract`, `./client`, `./server`, `./next` | oui |
| `apps/shenron/site` (client) | `./net` | `./constants`, `./types` | `./client`, `./policy`, `./staff` | non | non | `./contract` | composants, `./lib/*`, `./styles.css` |
| `apps/shenron/bot` (Bun) | oui | `./bun-sql`, `./sql`, `./redis`, `./constants`, `./repos/*`, `./types` | tout sauf `./next`, `./client` | `<repo>` ; jamais `./cli` | oui | `./contract`, `./http`, `./server` | `./lib/utils`, `./styles.css` |
| `packages/shenron/pipeline`, `scripts/**`, `scripts/tools/shenron/cli.ts` | oui | `./sql`, `./bun-sql`, `./env`, `./guards` | non | `<repo>`, `./web`, `./cli` | oui | `./client` | non |
| `aphrody-ai/crates/aphrody-mcp` (`dragonball.*`) | — | — | — | — | — | client des routes Shenron ; catalogue MCP propre à Aphrody AI | — |

Arêtes interdites contrôlées : paquet → `apps/*` ; module `"use client"` →
`@shenron/{ai, db/postgres-js, db/sql, db/bun-sql, api/server, aphrody}` ;
`apps/shenron/bot` → `bun:ffi`, `@aphrody/bun`, `drawM3Scene*` ; site → sous-chemins
de classe `bun`.

### 4.3 Contrôle

`scripts/audit/shenron/scripts/ops/check-workspace-packages.ts` (`bun run check:packages`,
options `--package <nom>`, `--strict`, `--write-baseline`) construit le graphe
depuis les manifestes et depuis les imports réels, puis vérifie :

1. cibles `exports` existantes (un joker doit correspondre à au moins un
   fichier) et classe `shenron.runtime` pour chaque entrée ;
2. scripts `type-check`, `lint`, `test` présents, `private: true`, ni `dist`
   ni `main`/`module`/`files`/tsup pour les sept paquets ;
3. tsconfig étendant `../config/tsconfig/*.json`, sans `baseUrl`, `paths`,
   `ignoreDeprecations` ni `moduleResolution` node/node10/classic ;
4. arêtes du §4.1 et absence de cycle (dépendances, développement et pairs
   compris) ;
5. règles d'import du §3.0 via le parcoureur, imports à environnement vide,
   pureté navigateur ;
6. frontières d'applications du §4.2 ;
7. `transpilePackages` d'`apps/shenron/site/next.config.ts` couvrant chaque paquet
   de premier rang dont dépend le site.

Les violations préexistantes vont dans
`scripts/ops/check-workspace-packages.baseline.json` (not in repo), en deux sections :
`transitional` (doit être vide à la fin de la Phase 1) et `phase2` (chaque
entrée cite un ticket). Une entrée devenue caduque produit un avertissement ;
`--strict` échoue si `transitional` n'est pas vide.

---

## 5. Délégation Aphrody/Rust

La doctrine est celle d'[`APHRODY-ECOSYSTEM.md`](APHRODY-ECOSYSTEM.md) (§1 principes,
§1.3 frontières autorisées, §1.4 interdits, §4 matrice, §5 contrat
d'environnement, §6 manques). Ce qui s'applique à la pile :

- **Frontières de processus seulement** : HTTP REST Bearer vers
  `aphrody-ai-http`, HTTP OpenAI-compatible vers `aphrody-shenron-embed`,
  HTTP vers `aphrody-web-api`, CLI `--json` par `Bun.spawn` pour les lots.
  Pas de FFI, pas de bibliothèque compilée localement, pas de Rust ici.
- **Pas de calcul local silencieux** : une capacité Aphrody absente renvoie
  un échec explicite (`AiResult`) et l'appelant dégrade de façon documentée
  (recherche lexicale, repli de persona en 503 `llm_unavailable`). La
  recherche locale SQLite (FTS5, `sqlite-vec`) existante reste derrière
  `RAG_BACKEND=local` jusqu'à la gate de réactivation d'`APHRODY-ECOSYSTEM.md`
  §6.2 ; aucun calcul local nouveau n'est ajouté.
- **Pas d'adresse par défaut** dans le code neuf (D16).
- **OCR** : `engine` par défaut `ppocr` dans le client neuf ; jamais de
  décision fondée sur `health().ocr` (drapeau de compilation) ; la façade
  héritée garde `gemini-web` pour `TranslateService` jusqu'à SH-AI-2.

| Opération lourde | Service du catalogue | Entrée Shenron | État en fin de Phase 1 | Cible et ticket |
| --- | --- | --- | --- | --- |
| Chat LLM | `aphrody-ai-http` `llm/chat` | `@shenron/pipeline/ai/chat` (`LanguageModelV4`) | adaptateur livré ; repli persona si `llm=false` | APH-3 (chat OpenAI-compatible authentifié), APH-8 (backend catalogué), APH-10 (file d'attente serveur, 429) |
| Embeddings | `aphrody-ai-http` `embed` ; `aphrody-shenron-embed` en repli | `@shenron/pipeline/ai/embeddings` | D10 appliqué, clients paresseux | APH-6 (parité de normalisation), APH-7 (épinglage SHA, portage `OrtEmbedder`) |
| Reranking | dans `rag/search` | aucune (pas de modèle client) | `RERANK_URL` reste mort jusqu'à SH-AI-2 | APH-5 (`hybrid+rerank` côté serveur) |
| Recherche RAG | `aphrody-ai-http` `rag/*` | `@shenron/pipeline/ai/aphrody` + `apps/shenron/bot/src/lib/rag.ts` | inchangé (`RAG_BACKEND`) | APH-1 (release alignée, pool), gate §6.2 |
| Indexation RAG | `rag/ingest`, `rag/sync/finish` | scripts du pipeline via la façade | inchangé | APH-1 |
| Évaluation RAG | `aphrody-rag-eval --target mcp` | `@shenron/pipeline/ai/eval` | métriques partagées bot/site/pipeline | APH-11 (cible `http` avec Bearer) |
| OCR, vision | `aphrody-ai-http` `ocr`, `vision/structured` | `@shenron/pipeline/ai/aphrody` | client livré (ppocr par défaut) | SH-AI-2 (retrait du service Python `relecture-ocr`) |
| Traduction | `scripts/tools/shenron/scripts/ops/translate-databooks-session.ts` + Aphrody `ja→fr` + replis | `@shenron/pipeline/translation` | supervisée Bun, dépôt PostgreSQL, preuve sous `var/runs/`, RAG rejouable ; canon/wiki restent séparés | APH-9, OS-5 |
| Crawl, scrape | `aphrody-web-api` | `@shenron/pipeline/aphrody/web` | inchangé | OS-4, P2-BXC |
| Transformations d'image | à créer | `@shenron/images` | sharp inchangé | OS-2 (port `ImageOps`) |
| Rendu 2D des cartes | npm préconstruit | `@aphrody/canvas` | façade 1.0.9-aphrody.2 livrée (D13), shim hors cibles préconstruites | CI-2 (preuve Linux), OS-3 (rendu hors processus) |
| Pont natif | aucun | `@shenron/pipeline/aphrody/cli` | FFI supprimé | — |

---

## 6. Migration des consommateurs

Légende : **F** = façade conservée au chemin actuel. `V1`…`V5` = vague de la
Phase 1.

### 6.1 Base de données

| Consommateur | Cible | Vague | F |
| --- | --- | --- | --- |
| `apps/shenron/site/src/lib/db.ts` (75 importateurs) | `@shenron/db/postgres-js` ; garde `server-only`, pool `globalThis`, `closeDb`, réexportations | V3 | F |
| `apps/site/src/db/{schema,bot-schema}.ts` | inchangés | — | F |
| `apps/shenron/site/src/lib/databooks-freeze.ts` (+ ≈ 13 scripts) | `createDatabooksFreezeGate` ; `DATABOOKS_FREEZE_FILE` via `resolveDataPath` ; S11 | V3 | F (mêmes exports) |
| `apps/shenron/site/drizzle.config.bot.ts` | refuse `push`/`migrate` avant toute connexion | V3 | — |
| `apps/shenron/site/package.json` `db:push` | refus explicite (orchestrateur) | préparation | — |
| `scripts/tools/shenron/cli.ts` | `loadDatabaseUrl` ; `db migrate site` refuse `push` et renvoie au runbook ; `db sync` mort supprimé ; chemin personnel absolu supprimé | V3 | — |
| `apps/bot/src/services/{EpisodesService,BxcBridgeService}.ts` | `PgService` (`apps/shenron/bot/src/db/pg.ts`, paresseux, nullable, un seul pool `createBunDb` partagé entre Drizzle et SQL brut) — B2 | V3 | — |
| `apps/shenron/bot/src/workers/indexer.ts` | `createResilientRedis` — B8 | V3 | — |
| `apps/site/scripts/_databooks-base.ts urlBase` (40 importateurs, `sql.json`) | `loadDatabaseUrl` (mêmes fichiers de repli, même ordre) + `createSql` | V3 | F (nom conservé) |
| `scripts/ops/wiki-databooks-indexer.ts getDbUrl` (12) | `loadDatabaseUrl` — B1 | V3 | F |
| `packages/pipeline/scripts/_rag-sources-pg.ts urlPostgres` | `loadDatabaseUrl` (repli personnel conservé jusqu'à INFRA-3) | V3 | F |
| `packages/shenron/pipeline/src/aphrody/a2a-probes.ts` | `loadDatabaseUrl` avec la liste actuelle | V3 | — |
| ≈ 200 scripts feuilles | lots mécaniques + cliquet | Phase 2 (SH-DB-3) | — |

### 6.2 Authentification

| Consommateur | Cible | Vague | F |
| --- | --- | --- | --- |
| `apps/bot/src/api/auth.ts checkAdmin` | S1 en place (V1), puis `authorize()` avec les stratégies dans l'ordre historique (V3) | V1, V3 | F (signature, 131 usages de `admin()`) |
| `apps/shenron/bot/src/api/server.ts` | S3, S4, S5 (V1) ; S7 côté bot (V3) | V1, V3 | — |
| `apps/shenron/bot/src/lib/better-auth.ts` | origines S2 et crochet S1 (V1) ; preset Discord B10 (V3) | V1, V3 | chemin conservé |
| `apps/shenron/site/src/lib/auth.ts` | origines S2 (V1) ; `discordProvider`, `loggingOptions`, `SESSION_COOKIE_CACHE`, `drizzleDebugLogs`, import inutilisé retiré (V3) | V1, V3 | chemin conservé |
| `apps/shenron/site/src/proxy.ts` | S2 (V1) ; `getSessionCookie` de `better-auth/cookies` et constante `ADMIN_COOKIE` (V4) | V1, V4 | — |
| `apps/shenron/site/src/app/api/a2a/route.ts` | S5 (V1) ; import `@shenron/pipeline/aphrody/a2a` (V2) | V1, V2 | — |
| `apps/site/src/lib/{admin-token,api-token}.ts` | codec et `verifyStaticBearer` ; vecteurs dorés générés avant bascule | V3 | F (simulées par les tests) |
| `apps/site/src/lib/{session,proxy-admin}.ts` | `staffPolicyFromEnv(env, "site")`, `createDiscordAccountLookup`, `requestHeaders()` ; API publique inchangée | V3 | F |
| `apps/site/src/lib/{auth-client,agent-keys,agent-scopes,agent-api,contribution-rights-shared,wiki-launch-config}.ts` | `./client`, `./agent-keys` + `@shenron/db/repos/agent-keys`, `decideAccess(…, { emptyRoles })`, S8 | V3 | F |
| `apps/bot/src/api/{user-auth,session,oauth}.ts`, `lib/env.ts`, `apps/shenron/bot/src/services/games/tokens.ts` | `verifyActingUser` (vecteur partagé), `timingSafeEqualString`, `staffPolicyFromEnv(env, "bot")` ; S10 : avertissement | V1, V3 | F |
| 15 routes `hasValidApiToken` | `isAdminOrToken(req)` dans un module neuf `apps/shenron/site/src/lib/admin-guard.ts` qui importe les façades `@/lib/session` et `@/lib/api-token` (les simulations des tests restent effectives) ; chaque route garde son `forbidden()` local ; instantané statut/corps avant bascule | V4 | — |
| `apps/site/src/app/api/{bot-user/[...path],telemetry,tierlists/upload}/route.ts` | `signActingUser`, `timingSafeEqualString`, S7 côté site | V4 | — |
| 7 fichiers `"use server"` | inchangés (façade `requireAdmin`) | Phase 2 (SH-API-4) | — |

### 6.3 IA et Aphrody

| Consommateur | Cible | Vague | F |
| --- | --- | --- | --- |
| Racine `@shenron/pipeline/aphrody` (bot, site, pipeline, scripts) | racine sans `bun:ffi`, `bun:sqlite`, `sharp` ni A2A | V2 | import inchangé |
| `apps/site/src/app/api/{a2a,admin/dashboard-live}/route.ts` + `tests/admin-dashboard-{live,token}.test.ts` | `@shenron/pipeline/aphrody/a2a` via `apps/shenron/site/src/lib/a2a-hub.ts` (configure le notificateur depuis `@/lib/admin-lab`) ; les `mock.module` des deux tests sont repointés **dans le même changement** | V2 | — |
| `packages/pipeline/src/aphrody/{compute,shenron-embeddings}.ts` | façades sur `@shenron/pipeline/ai` | V3 | F |
| `apps/shenron/bot/src/lib/rag.ts` | modèle d'embedding paresseux (B3) ; l'aide de réponse part dans `rag-answer.ts` (réexportée) ; `rag.ts` n'importe plus `llm.ts` | V3 | F |
| `apps/shenron/bot/src/lib/llm.ts` | prompts et génération de `@shenron/pipeline/ai` ; port `ChunkContentPort` sur `rag_chunks` ; historique Redis résilient ; portée de cache avec `PROMPT_VERSION` (B7, B17) ; signature `generateLlmAnswer(db, …)` inchangée | V3 | F |
| `apps/bot/src/lib/{semantic-cache,rag-eval}.ts`, `apps/shenron/bot/src/services/TrainingService.ts` | paresseux ; B18 ; métriques partagées ; `resolveDataPath("ragGold", { legacyDefault })` | V3 | F |
| `apps/site/src/lib/{site-rag,ia-cockpit}.ts` | `generateText` via le fournisseur, `instructions`, garde partagée ; métriques réexportées | V3 | F |
| `packages/shenron/pipeline/src/workflows.ts` | `generateGroundedAnswer` (B5) | V3 | — |
| `packages/pipeline/scripts/{rag-build,rag-embed-vectors,rag-eval,rag-lexique,rag-resync-entites,ingest-aphrody-rag,rag-status}.ts`, `scripts/tools/shenron/scripts/ops/eval-aphrody-rag.ts` | imports cassés réparés, `SHENRON_E5`, `@shenron/pipeline/ai/eval`, B6, B13 ; `tsconfig.scripts.json` avec cliquet | V4 | — |
| `packages/pipeline/src/{translation/index,cli,index}.ts` | B12 | V4 | façade unifiée vers le superviseur databooks |
| `apps/shenron/bot/src/services/TranslateService.ts` | inchangé (façade) | Phase 2 (SH-AI-2) | — |

### 6.4 API

| Consommateur ou contrat | Cible | Vague |
| --- | --- | --- |
| Bot : repli `fetch` de `server.ts` | `if (shenronApi.handles(pathname)) return shenronApi.fetch(req)` avant le 404 JSON ; câblage dans `apps/shenron/bot/src/api/shenron-api.ts` (port wiki depuis `PgService`, limiteur adossé aux seaux existants pour un budget unique) ; B14 | V4 |
| Bot : `/graphql` | schéma inchangé, limiteur public (S9) | V4 |
| Site : `app/api/public/[...route]/route.ts` (neuf) | `toNextRouteHandlers(createShenronApi(sitePorts))`, `runtime = "nodejs"`, `dynamic = "force-dynamic"` | V4 |
| `apps/shenron/site/src/lib/bot-admin.ts`, `app/admin/sync/page.tsx` | client validé (B11), cast supprimé | V4 |
| `apps/shenron/site/src/app/api/admin/ia/route.ts`, `lib/ia-cockpit-server.ts` | corps du contrat, `FEEDBACK_STATUSES` de `@shenron/db/constants`, client typé à la place de `postToBot` ; `revalidatePath` conservé ; lecture du salon admin conservée | V4 |
| `apps/shenron/site/src/lib/config.ts` | résolveur unique de l'URL du bot pour ces clients | V4 |
| `apps/site/src/lib/{shenron,member-roles,db-universe}.ts`, `components/home/useLiveBotState.ts`, téléversements, actions serveur | Phase 2 (SH-API-4) | — |
| `aphrody-ai/plugins/aphrody/skills/dragon-ball/**`, `app/llms.txt/route.ts`, `aphrody-mcp` | tests de dérive (§8.4) ; documents mis à jour dans le même commit que tout changement de contrat | V4 |

### 6.5 Interface

| Consommateur | Cible | Vague | F |
| --- | --- | --- | --- |
| `apps/shenron/site/src/lib/utils.ts` (35 importateurs) | `export { cn } from "@shenron/ui/lib/utils"` | V1 | F |
| `apps/shenron/bot/src/dashboard/lib/utils.ts` | réexporte `cn`, **garde** `formatBytes`, `formatDuration`, `formatRelative` | V1 | F |
| `apps/shenron/site/src/app/globals.css` | `@import "@shenron/ui/styles.css";` après `tailwindcss`, `@source` ; `--shell-*`, `[data-wiki-surface]` et doublons non en couche restent | V1 | — |
| `apps/shenron/site/tests/site-theme.test.ts` | lit `globals.css` et `packages/shenron/ui/src/styles.css` | V1 | — |
| `components/ui/Pagination.tsx`, `kit/LinkPager.tsx` | alias de `pageWindow` (V1) ; composant à libellés en props (V3) | V1, V3 | F |
| 10 wrappers (`accordion`, `badge`, `button`, `card`, `input`, `label`, `radio-group`, `switch`, `tabs`, `toggle`) + `index.ts` | réexportations d'une ligne ; B15 | V2 | F |
| `components/icones/*`, `lib/icones.ts` (102 importateurs), `apps/shenron/site/scripts/rend-icones.ts` | `@shenron/ui/icones` | V3 | F |
| `apps/shenron/bot/src/dashboard/styles.css` | `@import` + `@source` + surcharge qui garde la palette bleue et le rayon 0 | V4 | — |

### 6.6 Façades conservées après la Phase 1

`apps/site/src/lib/{db,session,api-token,env,admin-token,auth-client,proxy-admin,agent-*,databooks-freeze,utils,ia-cockpit,site-rag}.ts`,
`apps/site/src/db/{schema,bot-schema}.ts`,
`apps/site/src/components/{ui,icones}/**`,
`apps/bot/src/api/{auth,user-auth,session}.ts`,
`apps/bot/src/lib/{llm,rag,rag-eval,semantic-cache}.ts`,
`packages/pipeline/src/aphrody/{compute,shenron-embeddings}.ts` et la racine
`@shenron/pipeline/aphrody`, la racine `@shenron/db` et `./bun`. Motifs : tests qui
simulent ces chemins, 56 modules `server-only`, `@/lib/env` (t3) propre au
site, monolithe `server.ts` (203 `container.resolve`), importateurs externes.

---

## 7. Phasage

### 7.1 Protocole multi-agents

- **Fichiers réservés à l'orchestrateur** : `package.json` racine (catalogue,
  scripts), `bun.lock`, `bunfig.toml`, tous les `apps/*/package.json`, les blocs
  de dépendances de `packages/*/package.json`,
  `packages/config/tsconfig/*.json` (figés en vague 1), `PLAN.md`,
  `CHANGELOG.md`, `CLAUDE.md`, `AGENTS.md`, `packages/ui/material-web/docs/STACK.md`,
  `var/stack-research/**`.
- **Un agent ne doit jamais** : lancer `bun install`/`add`/`remove`, `git add`,
  `commit`, `stash`, `reset`, `checkout -- <chemin>`, `rebase` ; formater tout
  le dépôt (seulement `oxfmt <fichiers possédés>`) ; lire ou écrire un
  `.env*` ; se connecter à une base autre qu'une base L2 ; exécuter
  `drizzle-kit push|migrate|generate` ; lancer `rag:build` ou un script du
  pipeline contre une base ; toucher un fichier hors de ses chemins possédés
  et partagés. Après modification d'une commande, d'un événement ou d'une
  garde du bot : `bun run gen:entries` (règle 7).
- **Rapport d'agent** : fichiers modifiés (sous-ensemble des chemins
  possédés), gates exécutés avec codes de sortie et décomptes
  réussite/échec/ignoré, identifiants S/B utilisés, points ouverts.
- **Boucle de l'orchestrateur par vague** : relever `git status --short` ;
  lancer les agents ; rejeter toute modification hors possession ; lancer le
  gate global (§8.1) ; commiter tranche par tranche, fichier par fichier, en
  français sur une ligne avec l'identifiant S/B (règle 6) ;
  `git pull --rebase origin main && git push` (règle 13) ; ajouter une ligne
  au journal de `PLAN.md` avec les décomptes réels.
- **Retour arrière** : `git revert` de la bascule, puis du commit de paquet,
  dans l'ordre inverse des dépendances. Jamais `reset --hard`, jamais de push
  forcé.

### 7.2 Phase 1 : maintenant, vérifiable sur le poste local (L0/L1, L2 optionnel)

**Préparation (orchestrateur).** Catalogue : `@ai-sdk/provider` 4.0.17 et
`postcss` 8.5.26 déclarés (déjà verrouillés), retrait de `eslint`,
`eslint-config-next`, `@eslint/eslintrc`, `@eslint/js`, `@ai-sdk/react`,
`@modelcontextprotocol/sdk` ; `@aphrody/canvas` est déjà épinglé et verrouillé (`1be3116a`, D13).
Manifestes : `packages/shenron/config` créé avec ses presets ; dépendances de
travail ajoutées (bot → `config`, `db`, `ai`, `api`, `ui` ; `better-auth` en
pair de `auth` ; `api` sans `ai` ; `aphrody` sans `sharp` ni tsup) ; scripts
`lint` et `db:push` du site ; script racine `check:packages`. Un seul
`bun install` ; le diff de `bun.lock` ne doit contenir que des retraits et les
liens d'espace de travail : aucune résolution neuve.

| Vague | Flux (un agent chacun) | Contenu | Sortie |
| --- | --- | --- | --- |
| **1 — gates et sécurité** | `tooling` | `@shenron/config`, oxlint pour le site, TS2345, `turbo.json` (`transit`, entrées explicites), POLICY de `test-all` (paquets neufs, suites du site depuis la racine par liste d'exclusion à cliquet), `check-workspace-packages`, graines réelles `ai` et `api`, `useTypeScriptCli` explicite | CI réparable : type-check, lint et tests stricts verts |
| | `auth` | S1, S2, S3, S4, S5, S6, S10 en place | tests de régression de chaque S |
| | `ui` | `cn`, `styles.css`, `tokens.ts`, `pageWindow`, façades `cn` | équivalence CSS prouvée |
| **2 — paquets** | `db` | sous-chemins, clients bruts, constantes, dépôts, gel, Redis | tests L0 hors connexion |
| | `auth` | primitives, gardes, options, politique, adaptateurs, vecteurs dorés | vecteurs identiques aux implémentations actuelles |
| | `ai` | config, miroirs, client, embeddings (D10), chat, fournisseur, prompts, génération, évaluation | corps de requête exacts, parité des métriques |
| | `aphrody` | source seule, racine réduite, `./cli`, notificateur injecté, sous-chemin A2A pour le site (simulations repointées) ; B16 | racine sans `bun:ffi` |
| | `ui` | 10 wrappers et correctifs 1.8 ; B15 | tests de sélecteurs |
| **3 — bascules** | `db` | façades du site, gel S11, garde `drizzle.config.bot.ts`, `scripts/tools/shenron/cli.ts`, audit des migrations, `PgService` (B2), Redis de l'indexeur, résolveurs partagés (B1) | le bot démarre sans PostgreSQL |
| | `auth` | façades site et bot, preset Discord (B10), S7 côté bot, S8, conformance des ports | instantanés et vecteurs verts |
| | `ai` | façades de calcul, consommateurs du bot, du site et du pipeline (B3, B4, B5, B7, B8, B17, B18) | `rag.ts` n'importe plus `llm.ts` |
| | `api` | contrat, client, http, serveur, adaptateur Next, OpenAPI généré | conformance `satisfies WikiReadPort` |
| | `ui` | `./icones`, composant `Pagination` à libellés | tests de chemins du site verts |
| **4 — montages et nettoyage** | `api` | montages bot et site (B14), S9, client admin validé (B11), cockpit sur le client typé, tests de dérive externes | routes historiques prioritaires, nouvelles routes servies |
| | `auth` | 15 routes via `admin-guard.ts`, S7 côté site, proxy | instantané statut/corps inchangé |
| | `ai` | scripts du pipeline (B6, B12, B13), gate de type-check des scripts | cliquet des exclusions |
| | `ui` | styles du tableau de bord du bot | CSS compilée équivalente |
| **5 — clôture** | `tooling` | cliquet `transitional` vidé, gates de CI ajoutés, test de pureté des modules client, démarrage du bot sans services, docs d'infra ; seul, après la vague 4 | `check:packages --strict` vert |

Le détail exécutable (chemins possédés, tâches, critères, tests, commandes)
est tenu dans [`PLAN.md`](../../../PLAN.md); le fichier de recherche
`var/stack-research/work-breakdown.json` (not in repo) n'est pas versionné.

**Critères de sortie de la Phase 1** (L0/L1 sur le poste local) :

1. Gate global vert (§8.1), dont `check:packages --strict`.
2. `git grep` des imports `bun:ffi` dans `apps/` et `packages/` : zéro ; paquet
   de la racine `@shenron/pipeline/aphrody` sans `bun:ffi`, `bun:sqlite` ni `sharp`.
3. Instantané OpenAPI, routes lues par `aphrody-mcp`, dérive des documents du plugin et
   de `llms.txt` verts.
4. Équivalence CSS du site et du tableau de bord du bot.
5. Chaque élément S/B a son test et son commit ; journal de `PLAN.md` à jour
   avec les décomptes réels.
6. **Explicitement non revendiqué** : `next build` complet (L3), binaire
   canvas Linux (L3), tout état de production (L4), exactitude des données
   PostgreSQL des nouvelles routes (L2/L4).

### 7.3 Phase 2 et suivantes : tickets par dépôt propriétaire

**`shenron`**

| Ticket | Contenu | Débloque ou dépend de |
| --- | --- | --- |
| CI-2 | Job Linux : `next typegen` + tsc (types de routes), `next build`, `canvas-render.test.ts` sur ubuntu | retrait du shim canvas ; preuve du build ; dépend de CI-1 |
| DB-P3 | Réparation de l'historique : `tablesFilter` complet (33 tables), DDL `bot.*` dans `migrations/bot`, instantané de référence, migrateur Bun sur un client dédié amorcé avec les empreintes appliquées, déplacement vers `packages/shenron/db`, mise à jour dans le même commit d'`audit-refonte-architecture.ts`, des tests qui lisent le SQL et des motifs d'ignorance oxlint/oxfmt ; essai à blanc puis première migration réelle via le runbook de l'Infra du monorepo | toute nouvelle table ; dépend d'OPS-1 |
| SH-DB-3 | Migration mécanique des ≈ 200 scripts feuilles vers `createSql`/`createBunSql` + `loadDatabaseUrl`, cliquet des copies de résolveurs | — |
| SH-API-2 | Portage de `/health`, `/api/health`, `/api/public/stats` et des routes RAG vers Hono avec instantanés de parité d'en-têtes ; fusion du document généré dans `/api/openapi.json` ; retrait de `buildOpenApiSpec` et de `_bot-routes.ts` ; premier groupe admin (`./hono`) | — |
| SH-API-3 | Bascule des routes SQLite `/api/public/wiki/*` vers PostgreSQL après diff de forme ; décision GraphQL avec mise à jour des documents du plugin | dépend d'OPS-3 |
| SH-API-4 | Clients restants du site (`shenron.ts`, `member-roles.ts`, `db-universe.ts`, `useLiveBotState.ts`, téléversements) ; 7 actions serveur sur `@shenron/auth/next` | — |
| SH-API-5 | Propriété des tables du cockpit (`admin_goals`, `rag_eval_history`, `rag_training_feedback`) | dépend d'OPS-3 et de DB-P3 |
| SH-PATHS | Écrivains mutables (jeu d'or, `AdminReportGoalService`, `COORD_DIR`, hub A2A) sur chemins obligatoires en production | dépend d'INFRA-1 |
| SH-A2A | Activation de `SHENRON_A2A_ENFORCE` ; raccordement des outils `dragonball.a2a_*` d'`aphrody-mcp` au hub Shenron | vérifier le jeton et le catalogue infra avant activation |
| SH-SESSION | S10 : la clé HMAC héritée ne se replie plus sur `API_ADMIN_TOKEN` | dépend d'INFRA-2 |
| SH-UI-2 | Primitives toriyama, sort des 14 wrappers inutilisés, extraction optionnelle du cœur du kit derrière une prop de lien, cliquet de la règle 10, retrait de `shadcn/tailwind.css` | dépend d'OWN-7 |
| SH-SITE-REDIS | Façades Redis du site (`memory-rate-limit.ts`, `databooks-redis.ts`) sur `createResilientRedis` | — |
| SH-AI-2 | Retrait de `RERANK_URL`, `apps/bot/src/lib/embeddings.ts` (not in repo), NLLB, LibreTranslate, service Python `relecture-ocr` ; OCR du bot sur ppocr ; lexique unique | dépend d'APH-2, APH-5, APH-9 |
| SH-ID | Unification d'identité : purge d'un compte dans tous les magasins, avenir du silo du bot | dépend de DB-P3 et d'INFRA-2 |
| SH-SOFTDEL | Suppression logique pour `WikiCategory`/`WikiPage` et les posts | dépend de DB-P3 |
| P2-BXC | `@shenron/pipeline/bxc` en source seule, chemins absolus retirés | — |
| SH-TOOLING-P3 | Scripts racine `manga:ocr:*` repointés vers `@shenron/pipeline`, builds `@aphrody/*` hors `turbo build` | — |

**`aphrody`**

| Ticket | Contenu |
| --- | --- |
| APH-1 | Release d'`aphrody-ai-http` alignée sur le code (`rag/stats`, hybride) ; pool PostgreSQL à la place du `connect_db()` par requête (`http_rest.rs:1570-1581`) |
| APH-2 | `health` fidèle : `ocr` = modèle présent, capacité `embed`, version |
| APH-3 | Surface OpenAI-compatible authentifiée (`/v1/chat/completions`, `/v1/models`) sur `aphrody-ai-http`, jamais sur le port de la passerelle (celui de `nie-model-serve`) ; `createOpenAICompatible` remplace alors l'adaptateur |
| APH-4 | Comparaison du Bearer à temps constant (`http_rest.rs:146-148`, comparaison de chaînes) ; jeton exigé pour les outils `/mcp` qui écrivent |
| APH-5 | Rerank côté serveur dans `shenron_rag_search_core`, mode `hybrid+rerank`, repli RRF |
| APH-6 | Parité de normalisation : le proxy `embed` réduit `\s+` comme le client (`http_rest.rs:1062` ne fait que `trim`) ; fixture de vecteurs dorés (cosinus ≥ 0,997) |
| APH-7 | Contrôle SHA-256 et épinglage de révision au démarrage d'`aphrody-shenron-embed`, puis portage `OrtEmbedder` |
| APH-8 | Backend LLM catalogué (sans transfert de cookie entre hôtes) |
| APH-9 | `/api/v1/shenron/translate` ou `aphrody translate --json`, glossaire fourni par l'appelant |
| APH-10 | File d'attente LLM côté serveur, 429 avec `Retry-After` |
| APH-11 | `aphrody-rag-eval --target http` avec Bearer |
| MCP-1 | **Clos / remplacé (2026-09-26)** : outils `dragonball.*` portés dans `aphrody-mcp`; le MCP local ne transporte pas `SHENRON_A2A_TOKEN` vers le hub. Vérifier et provisionner l'auth A2A via le contrat infra avant d'activer `SHENRON_A2A_ENFORCE`. |

**`aphrody-os`** (scindé le 2026-09-25 : OS-1 et OS-3 relèvent désormais
d'`aphrody-ui`, OS-4 d'`aphrody-web` (`apps/bxc` (not in repo)), OS-5 d'`aphrody-ai`)

| Ticket | Contenu |
| --- | --- |
| OS-1 | `@aphrody/canvas` : la façade 1.0.9-aphrody.2 est publiée et consommée ; reste à accorder `.gitmodules` avec `docs/reference/ui/CANVAS-UPSTREAM.md` et à garder les versions suivantes sur les mêmes binaires préconstruits (win32-x64-msvc, linux-x64-gnu) |
| OS-2 | Service Rust de transformation et d'analyse d'image (redimensionnement, WebP/AVIF, dHash, PSNR, trait), catalogué ; `@shenron/images` devient un client à API inchangée |
| OS-3 | `aphrody-render` : texte multiligne et CJK, dégradés, 1200 × 630, images compactes, types TS générés |
| OS-4 | `aphrody-web-api` : état des jobs persisté, correctif `chunks=0` publié, exposition publique réconciliée, surface frames |
| OS-5 | Glossaire injecté dans `aphrody-translate` (avec APH-9) |

**l'Infra du monorepo**

| Ticket | Contenu |
| --- | --- |
| INFRA-1 | Variables de chemins mutables (`RAG_GOLD_PATH`, `SHENRON_ADMIN_DOCS_DIR`, `A2A_COORD_DIR`, `DATABOOKS_FREEZE_FILE`, `RAG_LEXIQUE`) vers le répertoire partagé de l'application, déclarées dans les environnements de `shenron-bot`/`shenron-site` et dans leurs `ReadWritePaths` |
| INFRA-2 | `SHENRON_A2A_TOKEN` pour le site et le bot ; confirmation de `SESSION_SECRET` ; scission de `SHENRON_ADMIN_TOKEN` (service site → bot, connexion admin, écriture databooks) ; nom canonique du secret acting-user ; `DISCORD_TOKEN` dans l'environnement du site |
| INFRA-3 | Confirmer `APHRODY_SHENRON_API_URL`/`_TOKEN` et `DATABASE_URL` dans les deux unités ; décider du sort des fichiers d'environnement personnels ; cataloguer Redis (`REDIS_URL`) ; champ de contrat d'environnement (`RAG_BACKEND`, `APHRODY_LLM_MODEL`, `APHRODY_WEB_API_URL`, `APHRODY_BXC_API_TOKEN`) |
| INFRA-4 | Hôtes Vercel morts ou non ; `X-Real-IP` posé par Nginx devant `shenron-bot` |
| INFRA-5 | Consigner « `@shenron/api` monté dans `shenron-bot` et `shenron-site`, pas d'unité `shenron-api` » ; réconcilier `application-contracts.json` (« reuse-rg-ui-contract », « reuse-rg-better-auth-boundary ») avec les paquets Shenron bâtis sur les motifs RG |
| INFRA-6 | Origines publiques de l'auth issues de `nginx-routes.json` ou de l'environnement |
| INFRA-7 | Plafonds de ressources d'`aphrody-ai-http` et d'`aphrody-shenron-embed` (pas de plafond serré pour `shenron-bot`, cf. son unité) |
| INFRA-8 | `SHENRON_REVALIDATE_SECRET` et route signée de revalidation du site, dès qu'une écriture partira du bot |
| INFRA-9 | Adaptateur de déploiement Shenron ; sondes après la release de la Phase 1 : `/health` jamais en 429 sous rafale MCP, `/api/public/wiki/categories` en 200, garde `/admin/*` inchangée, rendu canvas Linux |

**Opérateur et propriétaire**

| Ticket | Contenu |
| --- | --- |
| CI-1 | Débloquer le `startup_failure` de GitHub Actions (PLAN SH-P0-013) |
| OPS-1 | `bun packages/db/scripts/migration-audit.ts --probe --operator` en transaction lecture seule : `drizzle.__drizzle_migrations`, présence de `pg_trgm`/`unaccent`, tables hors Drizzle |
| OPS-3 | Propriété des tables du cockpit et sort du réplica SQLite du wiki (aucune unité de rafraîchissement n'existe) |
| OWN-7 | Décisions : valeur par défaut d'`ember`, périmètre staff du site (`OWNER_IDS`/`BOT_DEV_ID` ?), rétrogradation automatique de `roleAdmin`, caractère public de `/api/hls/:id/download`, palette du tableau de bord, sort des wrappers inutilisés |
| OWN-CLAUDE | Approbation de la mise à jour des chemins RAG de `CLAUDE.md` §3 (`packages/pipeline/scripts/rag-*`) |

---

## 8. Tests et gates

### 8.1 Gate global (orchestrateur, après chaque vague)

```sh
bun install --frozen-lockfile
bun run check:catalog
bun run check:packages                       # --strict à la sortie de la Phase 1
bun run type-check                           # turbo → tsc 7.0.2 natif (+ tsconfig.tests.json du site)
bun run lint                                 # oxlint partout
bun run test:ci                              # scripts/test-all.ts --strict
bun run audit:architecture && bun run audit:scripts
bun packages/api/scripts/openapi.ts --check  # à partir de la vague 3
bun packages/ui/scripts/generate-tokens.ts --check && bun packages/ui/scripts/check-css-equivalence.ts
bun packages/pipeline/scripts/ai/check-contracts.ts   # ignoré avec raison sans le dépôt voisin
oxfmt --check <fichiers modifiés>
git diff --check
```

Le workflow `aphrody-ci` (réutilisable, épinglé) exécute `bun run test`
(`turbo run test`) : chaque paquet garde au moins un test.

### 8.2 Conformance des paquets

`check:packages` (§4.3) et, dans chaque paquet, `test/portability.test.ts`
qui appelle `checkPackageRuntimes`, `checkNoEscapingImports` et
`checkEmptyEnvImports` de `@shenron/config/guards`.

### 8.3 Tests ajoutés par paquet

| Paquet | Fichiers | Ce qu'ils prouvent |
| --- | --- | --- |
| config | `test/{env,net,paths,guards,testing,portability}.test.ts` | messages sans valeur ; matrice loopback (formes crochetées, userinfo, https) ; priorité des variables et passage du défaut hérité ; parcoureur sur paquets de fixtures |
| db | `test/{drivers,env,constants,registry,wiki-repo,accounts-repo,agent-keys-repo,guards,redis,portability,migration-audit}.test.ts` | client `createSql` : sérialiseurs OID 114/3802/1184 intacts, client de `createDb` modifié ; dernière ligne gagnante ; `.toSQL()` avec `"visible" = $n` sur chaque requête et SQL identique entre `drizzle.mock()` postgres-js et bun-sql ; matrice du gel ; Redis recréé après mort ; les 21 identifiants de catégories sont couverts |
| auth | `test/{origins,a2a,crypto,tokens,acting-user,staff,guards,options,policy,agent-keys,next,hono,conformance,portability}.test.ts` | vecteurs dorés du cookie admin et d'acting-user produits par les implémentations actuelles ; ordre de `checkAdmin` ; non-staff → 403 ; aucune origine générique ni localhost en production ; `satisfies AgentKeyStore` |
| ai | `test/{config,wire,aphrody,embeddings,chat,provider,prompts,generate,eval,portability}.test.ts` | corps exacts : aucun préfixe vers `/api/v1/shenron/embed`, un seul vers `/v1/embeddings`, espaces réduits, ≤ 16 et séquentiel, un seul `fetch` sur 503 ; `generateText({ instructions })` → message system en tête ; outils refusés ; 125 s pour gemini-web ; ids de personas figés par instantané ; 172 cas du jeu d'or et métriques identiques à `rag-eval.ts` |
| aphrody | `test/{exports,cli,a2a-notifier,compute-facade,portability}.test.ts` | racine sans FFI ; CLI testée contre un binaire factice ; notificateur injecté ; façades : exceptions et corps identiques à l'ancien client |
| api | `test/{contract,client,http,server,conformance,openapi-drift,external-contracts,portability}.test.ts` | `.meta` → composants ; `fetch` lié tard ; vecteurs ETag de `server.ts` ; `/categories` avant `/{category}` ; `handles()` faux sans port ; `satisfies WikiReadPort` sur `drizzle.mock` |
| ui | `src/lib/*.test.ts`, `test/{tokens,styles,selectors,icones,pagination,portability}.test.ts` | dérive des jetons ; `var(--dbz-x,` pour chaque clé de thème ; aucun `data-[expanded]`/`data-[selected]` ; parité de `pageWindow` |
| apps/bot | `tests/{check-admin-staff,request-guards,a2a-auth,llm-allowed-mentions,check-admin-order,acting-user-vector,assets-upload-acting-user,pg-service,rag-import-graph,shenron-api-mount,graphql-rate-limit,boot-without-services}.test.ts`, `canvas-render.test.ts` réel sous win32 | chaque S du bot ; démarrage sans `APHRODY_*`, `DATABASE_URL` ni `REDIS_URL` |
| apps/site | `tests/{a2a-route-auth,auth-golden-vectors,databooks-freeze,require-admin-or-token.snapshot,tierlists-upload-acting-user,public-api-route,bot-admin-client-drift,client-bundle-purity}.test.ts` + suites existantes | 15 routes × 4 appelants (anonyme, session admin, Bearer valide, Bearer faux) identiques à l'instantané pris avant bascule ; aucun module `"use client"` n'atteint IA, pilotes, serveur API ou Aphrody |

### 8.4 Contrôles de dérive des contrats

| Contrat | Contrôle |
| --- | --- |
| OpenAPI généré | `openapi/public.json` = document produit avec des ports factices (`--check`) |
| Catégories Dragon Ball MCP | Shenron possède les identifiants et labels ; test 21 identifiants uniques, chaque catégorie a une route de liste et de détail |
| Chemins du plugin et de `llms.txt` | chaque chemin est dans `ENDPOINTS` ou `LEGACY_PUBLIC_PATHS` ; `/graphql` présent ; chaque chemin annoncé par `llms.txt` a son `route.ts` |
| Wire Aphrody | fixtures de `@shenron/pipeline/ai/wire` vs `http_rest.rs` (`check-contracts.ts`) |
| Acting-user | `ACTING_USER_TEST_VECTOR` vérifié par le paquet, la façade du bot et le signataire du site |
| Réponses d'administration du bot | formes enregistrées de `/api/stats/totals`, `/api/services`, `/api/database`, `/api/database/:table`, `/api/wiki/stats`, `/api/economy/stats` lues par les schémas du contrat |
| Jetons, CSS | `tokens.ts` = génération depuis `styles.css` ; équivalence de la CSS compilée (site, tableau de bord) |
| Migrations | `migration-audit --check` reproduit l'instantané commité (tout déplacement ou rejournalisation accidentel échoue) |

### 8.5 Paliers de `scripts/audit/shenron/scripts/test-all.ts`

- `unit` : les sept paquets, le bot (préparation `gen:entries`, précharge),
  le site lancé depuis la racine avec `--isolate` sur toutes les suites
  d'`apps/shenron/site/tests` sauf celles listées avec raison dans
  `scripts/test-all.site-baseline.json` (not in repo) (liste qui ne peut que rétrécir ;
  une nouvelle suite est incluse d'office), plus les tests de `scripts/ops/`
  et `apps/site/src/**/*.test.ts` jamais collectés aujourd'hui.
- `live` : `no-404` du site, `@shenron/pipeline/bxc`.
- `l2` : requêtes PostgreSQL et Redis réels, seulement avec `--l2` et des
  variables `SHENRON_TEST_*` valides.

---

## 9. Risques

### 9.1 Manques P0 de la critique

| Manque | Traitement | Risque résiduel |
| --- | --- | --- |
| `server-only` et l'environnement t3 font planter les paquets hors Next | règles du §3.0 appliquées mécaniquement ; façades du site conservées ; import à environnement vide | faible |
| Écritures dans la release immuable (jeu d'or, `GOALS.md`, `.coord`) | `resolveDataPath` avec défaut hérité et avertissement en production ; aucun écrivain ne passe dans un paquet sans chemin injecté ; INFRA-1 puis SH-PATHS | jusqu'à INFRA-1, la production se comporte comme aujourd'hui (écriture probablement refusée) : signalé, pas corrigé |
| Gel databooks inactif en production | `@shenron/db/guards`, fermé par défaut en production (S11) | écritures databooks refusées en production tant qu'INFRA-1 ne fournit pas le chemin : voulu par `PLAN.md` |
| Cockpit : lecture PostgreSQL, écriture SQLite, aucune synchro | aucun magasin ne change en Phase 1 ; aucune route neuve ne lit un magasin et écrit dans l'autre | affichage du cockpit toujours en retard (OPS-3) |
| API autonome en conflit avec l'infra et la passerelle Discord | montage dans les processus existants ; routes liées à la passerelle restent dans le bot | aucun |

### 9.2 Manques P1

| Manque | Traitement |
| --- | --- |
| Invalidation du cache Next non cartographiée | `InvalidationPort` ; règle de Phase 1 : aucune écriture qui affecte l'ISR ne quitte une route Next ou une action serveur ; route signée de revalidation en INFRA-8 |
| Actions serveur absentes des cartes | inchangées (façade `requireAdmin`), migration en SH-API-4 ; suppressions physiques signalées (SH-SOFTDEL) |
| Redis partagé et fragile | `createResilientRedis` avant tout port de limiteur ou de cache (B8) |
| Génération couplée au SQLite du bot | `ChunkContentPort` ; `rag.ts` n'importe plus `llm.ts` (test de graphe) |
| Jeu d'or : 5 résolveurs | `resolveDataPath("ragGold")` et `@shenron/pipeline/ai/eval` comme analyseur unique |
| Consommateurs externes non inventoriés | tests de dérive du §8.4 ; GraphQL conservé |
| Suppression de compte incomplète | silos non fusionnés ; SH-ID |
| Pas de contrat d'environnement partagé | `@shenron/config/env`, `ENV_ALIASES`, `DATABASE_POOL_MAX` dans l'environnement de build de turbo |

### 9.3 Risques d'implémentation

| Risque | Parade |
| --- | --- |
| Agents qui s'écrasent sur le même arbre | possession disjointe par vague, `server.ts` avec un seul propriétaire par vague, orchestrateur seul à installer et commiter, rejet des modifications hors possession |
| Mutation du client postgres-js par Drizzle | fabriques séparées ; test des sérialiseurs sans connexion |
| TS7 sans API JavaScript | oxlint seul, paquets en source, `useTypeScriptCli` explicite, lint typé optionnel |
| Tailwind v4 qui manque des classes du paquet ou change la cascade | `@source` des deux côtés ; blocs en `@layer components` ; critère d'équivalence : pour chaque couple sélecteur-propriété de la CSS compilée, la valeur effective ne change pas |
| Turbopack et paquets en source | `import.meta.url` interdit dans ce que Next atteint ; aucune classe `bun` dans le site ; build complet en L3 (CI-2) ; build « compile » optionnel en L1 (`next build --experimental-build-mode=compile`, option présente dans 16.3.5) |
| Méthodes HTTP plus strictes avec Hono | seules des routes neuves sont servies ; autres méthodes → même 404 JSON |
| Cache et limites divergents entre routes historiques et Hono | `fnvEtag` porté à l'identique avec vecteurs ; limiteur du bot adossé aux seaux existants |
| `@hono/zod-openapi` qui modifie zod globalement | contrat en zod pur ; noms de composants testés |
| Règles de prompt d'AI SDK v7 (`system` dans `messages` refusé) | `instructions` partout ; `allowSystemInMessages` jamais activé |
| Dérive de l'espace vectoriel (le serveur ne fait que `trim`) | réduction des espaces côté client sur les deux voies ; parité vectorielle en L4 (APH-6) |
| Reprises qui triplent la latence | `maxRetries: 0` sur le chemin chaud, décompte des appels `fetch` dans les tests |
| `site:migrate` du déploiement qui prendrait des migrations déplacées | rien n'est déplacé en Phase 1 (D5) |
| `.env` local avec une URL de base vivante | les tests ne lisent jamais `DATABASE_URL` ; sonde d'audit refusée sans `--operator` |
| Binaire canvas Linux non prouvé (GLIBC, rendu) | shim conservé hors cibles préconstruites ; preuve en CI-2 puis sonde INFRA-9 ; retour arrière d'une ligne de catalogue vers la version `1.0.9-aphrody.x` précédente de `@aphrody/canvas` ; correctif du binaire dans `aphrody-ui/packages/ui/canvas` |
| `minimumReleaseAge` | aucune résolution neuve prévue (`@ai-sdk/provider` et `postcss` déjà verrouillés, canvas déjà livré) ; tout ajout au diff de `bun.lock` est refusé |
| Changement de comportement glissé dans un « refactor » | registre S/B ; instantanés statut/corps, équivalence CSS, instantané OpenAPI et fixtures de parité IA font échouer les gates |

### 9.4 Décisions ouvertes : valeurs retenues pour ne pas bloquer

Toutes réversibles et consignées dans `PLAN.md` :

1. L'alias Vercel nommé reste ; seul le motif générique part (S2). Réponse
   finale : INFRA-4.
2. Staff du site = `OWNER_ID ∪ OAUTH_ALLOWED_USERS` ; pas de rétrogradation
   automatique de `roleAdmin` (OWN-7).
3. Les routes existantes gardent leurs corps ; le contrat ajoute un `code`
   optionnel à l'enveloppe `{ error }`, sans réemballage `{ ok, data }`.
4. Le bot est l'hôte canonique de `/api/public/*` ; le miroir du site est
   additif.
5. GraphQL conservé, lecture seule, profondeur 10, désormais limité (S9).
6. Le tableau de bord du bot garde sa palette bleue et son rayon 0.
7. La valeur par défaut d'`ember` reste celle d'aujourd'hui (OWN-7).
8. Les wrappers inutilisés restent dans le site en Phase 1.
9. `@shenron/pipeline/ai` lit `APHRODY_AI_EMBED_BASE_URL` (base en `/v1`), puis ses alias
   hérités ; `EMBED_URL` y est traité comme une origine (`/v1` ajouté). Aucune
   adresse par défaut ne subsiste (contrat l'Infra du monorepo v1, 2026-09-25).
10. Le chat reste sur l'adaptateur `LanguageModelV4` jusqu'à APH-3.
11. `application-contracts.json` (« reuse-rg-* ») se réconcilie par INFRA-5,
    sans rouvrir les décisions sur l'auth et l'interface.
