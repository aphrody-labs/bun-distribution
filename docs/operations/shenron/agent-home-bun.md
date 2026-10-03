<!-- SPDX-License-Identifier: Apache-2.0 -->
# Agent Home dbfr côté Bun/TS — consommateurs et branchement du prompt

Relevé du 2026-10-03 sur `main`, par lecture du code. Le profil privé
`~/.aphrody/workspaces/dbfr` est **lu seulement** : aucun contenu de profil, de corpus ni de
credential n'est copié dans ce dépôt, et aucun test du dépôt ne lit le profil réel (les fixtures
suffisent). Les variables d'environnement sont décrites dans [`ENV.md`](ENV.md).

## Résolution du profil

- Le profil du domaine Shenron est `~/.aphrody/workspaces/dbfr` (`config/ai/agent-domains.json`).
- `~/.aphrody/workspace-shenron` est un lien symbolique vers `workspaces/dbfr` (constaté le
  2026-10-03) : l'ancien nom et le nom canonique désignent le même dossier.
- Ordre de résolution documenté pour l'Agent Home
  ([`docs/products/ai/dot-aphrody/README.md`](../../products/ai/dot-aphrody/README.md)) :
  `$APHRODY_WORKSPACE`, puis `$APHRODY_PROFILE` → `workspace-<profil>`, puis `workspace`.
  `APHRODY_WORKSPACE` doit correspondre à `~/.aphrody/workspaces/<domaine>`.

## Consommateurs Bun/TS

| Consommateur | Lit | Chemin | Remarque |
| --- | --- | --- | --- |
| `getToriyamaPersona()` — `packages/shenron/pipeline/src/workflows.ts` | `SOUL.md`, `IDENTITY.md` | `$APHRODY_PROFILE_HOME`, sinon `~/.aphrody/workspace-shenron` | Lève « Profil Shenron incomplet » si un des deux manque. Aucun appelant hors test. |
| `packages/shenron/pipeline/scripts/build-chat-rollouts.ts`, `packages/shenron/pipeline/scripts/eval-chat-gold.ts` | `SOUL.md` (clé `tone` du frontmatter seule, via `soulTone`) | `--soul`, défaut `~/.aphrody/workspaces/dbfr/SOUL.md` | Le ton alimente `personaSystem` ; repli sur le ton canonique si le fichier ou la clé manque. |
| `packages/shenron/pipeline/scripts/build-chat-rollouts.ts`, commande bot `Train` | `training/triples.jsonl` | `--input`, défaut sous le profil dbfr | Données d'entraînement : jamais commitées. |
| `src/testing/live-rag.ts`, `packages/shenron/pipeline/scripts/rag-sync-aphrody.ts` | `indexes/shenron-rag-latest.json`, manifeste de synchro | `~/.aphrody/workspaces/dbfr/indexes` | Porte du RAG réel ; voir ci-dessous. |
| `packages/shenron/pipeline/scripts/rag-harvest.ts`, `packages/shenron/pipeline/scripts/aphrody-web-corpus-crawl.ts`, `rag-sync-aphrody.ts` | `crawl/` | `$APHRODY_HOME` (défaut `~/.aphrody`) + `workspaces/dbfr/crawl` | Frontière de crawl et données dans le profil ; chemin surchargeable par `APHRODY_CORPUS_CRAWL_DIR` (crawl) ou `APHRODY_HOME`. |

## Branchement persona et prompt

Trois sources de persona coexistent et ne se rejoignent pas :

1. **Exécution (bot et site)** — `@shenron/pipeline/ai/prompts` : `PERSONAS` (`whis` par défaut,
   `shenron`, …), `buildGroundingInstructions`, garde anti-injection, `PROMPT_VERSION` dans la
   portée du cache sémantique. `runIaTask` fixe la persona `shenron` de ce module. Aucune lecture
   de l'Agent Home.
2. **Entraînement et évaluation** — `personaSystem(tone)` des scripts, avec le `tone` de `SOUL.md`.
3. **`getToriyamaPersona()`** — renvoie le texte de `SOUL.md` et `IDENTITY.md`, mais `runIaTask`
   ne l'appelle pas : ces textes n'atteignent aucun prompt d'exécution.

Conséquences à trancher par les propriétaires de ces fichiers (hors périmètre de ce lot) :

- La persona `shenron` d'exécution (dragon pressé et impératif) et le `tone` de `SOUL.md`
  (solennel, bienveillant) sont deux caractérisations différentes ; un modèle entraîné sur la
  seconde est interrogé avec la première.
- `getToriyamaPersona()` ignore `APHRODY_WORKSPACE` et lit `APHRODY_PROFILE_HOME`, variable absente
  de la résolution documentée : sous un autre domaine (`ie`, `aphrody`) elle lit quand même dbfr.
- `IaTaskOptions.temperature` et `maxTokens` sont acceptés mais jamais transmis.

## Adaptateur `llm/chat` (`@shenron/pipeline/ai/chat`, `ai/provider`)

- Un identifiant de modèle vide ou blanc n'envoie **aucun** `model` : Aphrody garde son modèle par
  défaut (contrat de `runIaTask`). Avant correction, un client compute réel répondait
  `invalid_request: invalid model id`. Un identifiant renseigné est envoyé sans espaces de bord.
- Les réglages que la route ne sait pas porter (`maxOutputTokens`, `temperature`, `stopSequences`,
  `topP`, `topK`, `presencePenalty`, `frequencyPenalty`, `seed`, `responseFormat` JSON) ne sont plus
  ignorés en silence : ils sortent en avertissements `unsupported`, en `generateText` comme en
  `streamText`. Les outils, fichiers et images restent refusés par `UnsupportedFunctionalityError`.

## API admin IA (`/api/admin/ia`)

- Session absente → **401** (`WWW-Authenticate: Bearer`, sans cache) ; session sans rôle admin, ou
  compte pas encore lié → **403**. Le cockpit (`ia-cockpit-view.ts`) distingue déjà les deux.
- Corps JSON `null`, tableau, scalaire ou illisible → 400 « Action non reconnue. » (c'était un 500).
- `evaluate_rag` : `samples` absent → 25 ; `0` → tout le jeu doré ; entier positif plafonné à
  1 000 ; toute autre valeur → 400 au lieu de lancer en silence l'évaluation complète.
- Décisions pures dans `apps/shenron/site/src/lib/ia-aphrody.ts`.

## Gates

```bash
cd apps/shenron/site && bun test --isolate tests/parallel-ai-home.test.ts
cd packages/shenron/pipeline && bun test test/ai/chat.test.ts test/ai/provider.test.ts
cd packages/shenron/pipeline && node_modules/.bin/tsc --noEmit -p tsconfig.json
cd apps/shenron/site && node_modules/.bin/tsc --noEmit -p tsconfig.tests.json
```

Le `tsc` des paquets est TypeScript 7 (natif). `oxlint` s'exécute depuis `node_modules/.bin` à la
racine. `oxfmt --check` signale déjà les fichiers voisins non modifiés (le code est indenté à la
tabulation) : il ne sert pas de porte tant que ce formatage n'est pas décidé.

Tout test de récupération passe par `@shenron/pipeline/testing/live-rag` (`bun run rag:prepare`
puis `bun run rag:test` dans le paquet pipeline). Un préchargement incomplet bloque la porte : ne
pas la contourner par des fixtures de récupération.
