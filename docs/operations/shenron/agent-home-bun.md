<!-- SPDX-License-Identifier: Apache-2.0 -->
# Agent Home dbfr côté Bun/TS

État vérifié le 2026-10-03. Le profil privé reste dans
`~/.aphrody/workspaces/dbfr` ; aucun contenu de profil, corpus ou credential
n'est copié dans le dépôt. Les variables sont décrites dans [ENV.md](ENV.md).

## Résolution du domaine

`packages/shenron/pipeline/src/agent-home.ts` résout le domaine déclaré par
`APHRODY_AGENT_DOMAIN`, puis celui d'`APHRODY_WORKSPACE`, puis
`APHRODY_PROFILE` (`shenron` est l'alias historique de `dbfr`). Le défaut de
ce consommateur Shenron est `dbfr`. Un domaine étranger conserve la persona
canonique sans lire son profil ni revenir implicitement sur dbfr.

Un workspace explicite doit désigner `<APHRODY_HOME>/workspaces/<domaine>`
(les liens symboliques sont résolus) et correspondre au domaine déclaré.
Une configuration incohérente est refusée avant récupération ou génération.
`APHRODY_WORKSPACE` prime sur l'alias historique `APHRODY_PROFILE_HOME`.
Cet alias seul est refusé s'il désigne un workspace d'un autre domaine.
Sans dossier explicite, le profil canonique sert en priorité ; l'ancien
`workspace-shenron` ne sert que si le canonique manque.

## Consignes d'exécution

`runIaTask` lit seulement les fichiers `SOUL.md` et `IDENTITY.md` du profil
résolu. Seules trois clés de frontmatter atteignent le prompt : `tone`,
`brevity` et `vibe`. Chaque valeur devient une ligne bornée à 200 caractères,
sans caractères de contrôle. Le corps Markdown et les mémoires du profil
n'atteignent pas le prompt. La garde anti-injection reste en dernière position.

Les consignes s'appliquent au modèle AI SDK et à la fonction chat historique.
Un profil par défaut absent ou sans ces clés conserve la persona canonique.
Un dossier explicitement désigné mais introuvable produit une erreur.
`getToriyamaPersona` reste compatible et utilise désormais la même résolution ;
il renvoie les deux textes bruts à son appelant et exige les deux fichiers.
Il n'est pas utilisé pour construire les instructions de `runIaTask`.

Le bot et le site qui appellent directement `generateGroundedAnswer` gardent
les personas de `ai/prompts`. Les scripts d'entraînement/évaluation utilisent
leur option `--soul` et sa clé `tone`. Leur alignement complet n'est pas établi
par ce lot. `runIaTask` n'utilise pas de cache sémantique ; `PROMPT_VERSION`
reste inchangé. Pour les consommateurs avec cache, la portée lie déjà le
contenu du contexte, le modèle, la version du prompt et la persona.

## Qualification

Les tests du profil utilisent des dossiers temporaires ; les suites de
récupération utilisent le vrai corpus préchargé et `requireLiveRag`.

```bash
cd packages/shenron/pipeline
bun test test/workflows.test.ts test/workflows-ia.test.ts test/ai/prompts.test.ts test/ai/generate.test.ts test/ai/portability.test.ts
bun run type-check
bun run rag:test
```

Les cinq suites ciblées passent : 61 tests, 249 assertions, deux tests ignorés
préexistants. Le test `workflows-rag-live.test.ts` contrôle que les citations
réellement récupérées atteignent le prompt ; seul le modèle de capture est
simulé. Il exige le préchargement complet, sans contournement par des réponses
RAG fabriquées. La qualification live reste ouverte pendant l'ingestion.
