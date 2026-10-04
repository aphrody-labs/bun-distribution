# PLAN.md — Plan directeur unique de Shenron

> **Autorité opérationnelle unique** — vérifié le `2026-09-25T00:00:00Z`.
> Les anciens plans/audits restent des preuves historiques, mais ne pilotent plus l'exécution.

```json
{"schema":"shenron-plan/v1","last_verified_at":"2026-09-25T00:00:00Z","status":"INCOMPLET","authoritative_file":"PLAN.md","freeze":{"databooks":true,"path":".coord/FREEZE-databooks.json"},"baseline":{"databook_pages":17369,"with_japanese_text":16402,"with_french_text":11318,"pending_ocr":2528,"pending_translation":2556,"translation_suspects":0,"translation_corrupt_active":0,"rag_chunks":24775,"rag_gold_cases":172,"rag_gold_sources_present":172,"rag_recall_at_5_lexical":0.802},"open_workstreams":4}
```

## Invariants non négociables

- Manga, scans et déclarations d'Akira Toriyama priment ; Fandom est interdit.
- Aucune écriture OCR/traduction pendant le gel. Aucun worker n'est déclaré vivant sans processus ou heartbeat frais mesuré.
- Toute suppression éditoriale est logique (`visible = false`) et auditée dans `wiki_revisions`.
- Une réponse A2A `submitted` ou `INCOMPLET` ne vaut jamais travail exécuté.
- `rag:build` ne s'exécute ni au premier plan ni sur le bot de production.
- Livraison après `bun run test:ci`, `bun run type-check` et lint sans erreur sur le périmètre.

## Baseline vérifiée

| Surface | État actuel | Preuve |
|---|---:|---|
| Databooks | 17 369 pages ; 16 402 JA ; 11 318 FR | mesure PostgreSQL du 2026-09-25 |
| Restes | 2 528 OCR/source bloquées ; 2 556 traductions éligibles | mesure PostgreSQL du 2026-09-25 |
| Audit traduction | 0 suspecte active ; 0 corruption active | juge + garde de dépôt |
| Quarantaine | 1 104 traductions retirées ; 936 citations masquées | freeze + snapshots du 14 septembre |
| OCR local | 2 377 text ; 414 no-text ; 212 needs-review | sonde A2A 11:45 UTC |
| RAG databooks | 24 775 documents ; 10 286 traductions | `ingest-databooks-rag.ts` après arrêt |
| Gold RAG | 172/172 sources ; Recall@5 lexical 80,2 % | `rag-eval.ts --lexical-only --validate --ci` (2026-09-18) |
| Personnages | 435/669 articles remplis sans bibliographie | SQL live |
| Techniques | 24/825 sourcées ; 70 JA ; 65 romaji ; 596 images | MCP/SQL live |

## File d'exécution unique

| ID | Priorité | Statut | Propriétaire | Travail restant | Critère de clôture |
|---|---|---|---|---|---|
| SH-P0-014 | P0 | [ ] | wiki-page-builder | Transformer chaque nouvelle entrée crawlée en vraie page wiki structurée (route, schéma, sections et révision), sans arbitre éditorial. | Pages accessibles, structure typée, migration idempotente et révision créée. |
| SH-P0-015 | P0 | [ ] | wiki-corpus-enricher | Préparer l’enrichissement des nouvelles pages depuis le corpus manga/databooks avec citations de planches et provenance. | Dossiers de sources vérifiés ; aucune assertion sans preuve primaire. |

| ID | Priorité | Statut | Propriétaire | Travail restant | Critère de clôture |
|---|---|---|---|---|---|
| SH-P0-001 | P0 | [x] | backend-security | Fermer l'élévation OAuth MCP : retirer secrets implicites, wildcards client/redirect et autorisation de tout compte Google vérifié. | Fail-closed ; égalités exactes ; allowlists issuer/audience/email ; tests négatifs et suite MCP verte. |
| SH-P0-002 | P0 | [x] | quality-gates | Réparer le type-check racine rouge dans `audit-traductions-databooks.ts`. | `bun run type-check` exit 0. |
| SH-P0-003 | P0 | [x] | databooks-safety | Writers CLI/API/helpers couverts par le gel partagé ; écriture ciblée sous gardes ; `results.db` reçu par validation + renommage atomique. | Sortie 3 avant connexion prouvée ; 26 tests concurrence/rollback verts ; réception atomique et refus de corruption prouvés ; corruption active=0 ; gel maintenu. |
| SH-P0-004 | P0 | [x] | data-governance | Remplacer les suppressions physiques admin/wiki/databooks par masquage logique et révision transactionnelle. | Aucun `db.delete` éditorial ; tests masquer/restaurer, 404 public et révision. |
| SH-P0-005 | P0 | [x] | rag-quality | Corriger les 9 attentes gold absentes et rendre `--validate` bloquant en CI. | 172/172 sources ; Recall@5 ≥ 0,80 ; aucun faux matcher URL. |
| SH-P0-013 | P0 | [ ] | site-deploy | Rendre reproductible le build bleu/vert après l'OOM du SHA `1a329e3`. Invariant rétabli : unique `/swapfile-build4` de 8 Gio, aucun swap temporaire ; build VPS fail-closed sous 28 672 Mio. Le workflow Bun hors VPS est actif sur `origin/main`, mais GitHub Actions échoue avant tout job : runs manuel `34849187867` et push HEAD `34851686539`, zéro job/log, et les 101 runs récents de tous événements sont en `startup_failure` (`BuildFailed`). Actions autorisées et références valides ; compte non suspendu, seulement 59 minutes Linux remisées, aucune cause de politique/quota exposée par l'API. Blocage suivant prouvé : environnement `production` sans `SITE_BUILD_DATABASE_URL`. Le HEAD `aebc9329` est distant, mais aucun contournement par build sur le VPS réel `51.255.162.6`. | Amorçage Actions rétabli et secret de réplique read-only présent ; artefact du SHA courant réellement produit hors VPS, importé, sondé et basculé ; exactement 2 releases restent et `.next-build` est supprimé. |
| SH-P1-006 | P1 | [ ] | wiki-canon | Ré-ancrer articles et techniques sans sources primaires. Tranche exacte : 126 fiches ré-ancrées et révisées le 2026-09-14 ; 335 restent sans preuve exacte. Dernière vague MCP Dragon Ball : Awamo, Chilled, Chronoa, Chapchai et Cocotte, neuf ancrages exacts et cinq révisions transactionnelles ; Basaku, Chevil et Comfrey restent intacts faute de correspondance exacte non ambiguë. | 0 article rédigé sans sources ; chaque ajout sourcé et révisé. |
| SH-P1-007 | P1 | [ ] | ocr | Terminer 1 508 pages, priorité #465, #1, #463, #461, #34, #35, #29, #462. Sept lots #29 : 8 textes exacts et 20 planches visuelles. Deux lots #36 : 8 textes exacts. Deux lots #27/#28/#5/#22 : 6 textes exacts et 2 planches visuelles. Deux lots Anime Comics supplémentaires : sept synopsis japonais longs (#443/#446/#447/#451/#452/#454/#456) et le seul logotype visible #445. Lot #52:2 : une planche personnages de densité moyenne transcrite après double lecture de l'original et de deux agrandissements ; SHA-256/Sharp valides, `verifie` 1/1 et dépôt simulé 1/1, zéro PG. #34/#35 sans scan local ; premières entrées #462 absentes. #465 reste HTTP 403 sans contournement : source autorisée requise. | 100 % texte ou no-text visuel ; needs-review=0 ; santé stricte verte. |
| SH-P1-008 | P1 | [ ] | translation | Reprendre sous canary 11 401 traductions après revue des 291 suspectes. **Progrès 2026-09-14 :** 102/291 planches uniques relues sur scans : 85 verdicts de retrait, 17 conservations prouvées. Manifest canary atomique de 86 actions avec hash attendu et rollback par révision préparé ; 0 écriture sous freeze. Le décompte corrige deux revues dupliquées (`12/81`, `30/3`). | Gel levé après SH-P0-003 ; lexique protégé ; aucune corruption. |
| SH-P1-009 | P1 | [x] | entity-integrity | 15 identités déterministes consolidées et versionnées ; 31→22 groupes, tous les restants classés comme déclinaisons/homonymies dans `docs/audit/2026-09-14-name-ja-groups.json` (not in repo) ; variantes orphelines 21→0, `#2330` mise en quarantaine logique faute de cible canonique exacte. | Zéro doublon non justifié et variante visible orpheline ; révisions. |
| SH-P1-010 | P1 | [x] | site-audit | Corriger `audit-wiki-couverture.ts` : `[]`/`{}` sont vides ; auditer les 11 zones restantes. | Rapport JSON daté ; 38 frames, 12 subtitles épisodes, 3 players/streams et 2 subtitles films correctement comptés. |
| SH-P1-011 | P1 | [x] | backend-resilience | Remplacer les rate limits process-local par compteur atomique partagé. | Tests multi-instance/concurrence, `Retry-After`, comportement de panne documenté. |
| SH-P2-012 | P2 | [x] | observability | Unifier télémétrie MCP/A2A et résiduels UI/API reproductibles. | Snapshot courant explicite ; pas de `200 []` sur panne DB ; health, URL canonique, JA et hydratation testés. |
| SH-P2-013 | P2 | [x] | a2a | Hub A2A 1.0 canonique (`mcp.dragonballfr.com/a2a`) : `/msg` rejette les `kind` hors ai.json v1 (enveloppe `error`, aucun ordre) ; `error` hors tâche escaladé sur #bot-admin sans créer de tâche. Décision 2026-09-23 : étendre `packages/shenron/pipeline/src/aphrody/a2a.ts`, pas de second registre. | `bun test` package pipeline/Aphrody 21/22 (échec gix préexistant, hors A2A). |
| SH-P1-016 | P1 | [x] | stack-unification | Unifier DB, auth, UI, API et IA en paquets modulaires hors Next (`@shenron/{config,db,auth,images,api,ui,pipeline}`), en TypeScript 7 (tsc natif) et oxlint. Livré et qualifié : 9 paquets propres, 0 erreur de lint, 0 erreur de typecheck, 2 105 tests passants. | 9 paquets modulaires validés ; gates vertes ; tests exhaustifs. |
| SH-P0-017 | P0 | [x] | backend-security | S1 : `checkAdmin` du bot accorde l’admin selon la politique staff (OWNER_ID ∪ OAUTH_ALLOWED_USERS), 403 sinon. | Tests négatifs et staff checks validés (`check-admin-staff.test.ts`). |
| SH-P1-018 | P1 | [x] | a2a | S5 : écritures A2A bot/site sans jeton ; contrôle `SHENRON_A2A_TOKEN` derrière `SHENRON_A2A_ENFORCE` (avertissement par défaut) jusqu’aux tickets INFRA-2/MCP-1. | Drapeau testé ; suite A2A verte (`a2a-auth.test.ts`). |

## Séquencement autonome

1. Exécuter en parallèle SH-P0-001, SH-P0-002 et SH-P0-003.
2. Garder le gel jusqu'à clôture SH-P0-003 et revue des 291 suspectes.
3. Exécuter SH-P0-004/005, puis les enrichissements P1.
4. Reprendre OCR/traduction seulement avec heartbeats réels, canary validé et A2A `FAIT` avec artefacts.
5. Après chaque vague : tests, type-check, lint, mise à jour du tableau et notification admin.

## Sources déclassées

- Les anciens audits étaient des preuves seulement ; ils ont été retirés du dépôt.
- `docs/products/shenron/GOALS.md` et `docs/operations/shenron/ADMIN-REPORTS.md` : miroirs ; aucune mention « nominal » ne prévaut sur freeze/gate rouge.
- Seule la boîte racine `.coord/a2a-tasks.jsonl` (not in repo) est retenue, avec verdict final prioritaire.
- Les chiffres du 12 septembre doivent être rejoués ; ses suggestions Fandom sont nulles.

## Journal de validation

- `2026-09-14T11:46Z` — audits parallèles plans/logs, backend/ops et wiki/data ; MCP Dragon Ball, salon admin et A2A relus ; plan consolidé.
- `2026-09-14T12:05Z` — SH-P0-003 clos : garde commune CLI/HTTP/helpers, cinq writers oubliés arrêtés avec code 3 avant connexion, test PostgreSQL ciblé 26/26, réception `results.db` par changement d'inode avec rollback et rejet d'un fichier tronqué sans altérer la cible, audit actif à 0 corruption ; freeze conservé.
- `2026-09-14T12:16Z` — SH-P1-010 clôturé : prédicat JSON/array corrigé et testé (4/4), rapport horodaté produit, cinq résiduels exactement mesurés, matrice des onze zones ajoutée et quatre usages de police JP réparés. Les régressions déterministes découvertes par la gate ont été corrigées ; suite Site applicable : 999 succès, 8 intégrations ignorées, 0 échec. Le crawl production est opt-in (`SITE_TEST_LIVE=1`) et documente séparément la dérive du déploiement.
- `2026-09-14T13:34Z` — vague MCP Dragon Ball : Gowasu et Kafla ancrés sur quatre planches exactes avec deux révisions ; revue traduction portée à 88/291 et manifest à 72 quarantaines sans écriture. `bun run type-check`, `bun run lint`, `bun run test:ci` et le test canonique précédemment expiré passent ; la suite Site globale sans environnement configuré a compté 1 000 succès, 8 skips et 5 délais PostgreSQL, tous liés à `127.0.0.1:5432` indisponible.
- `2026-09-14T13:41Z` — lots traduction 23–24 : huit scans originaux ouverts et confrontés à JA/OCR/FR ; 7 quarantaines simulées et 1 conservation prouvée. Cumul 96/291 relues, manifest canary 79 actions, zéro écriture sous freeze.
- `2026-09-14T13:55Z` — lots traduction 25–26 : huit nouveaux scans ouverts ; 7 quarantaines et 1 conservation. Décompte historique dédupliqué : `12/81` et `30/3` avaient été relues deux fois ; cumul exact 102/291 planches uniques, 85 retraits, 17 conservations, manifest 86 actions, zéro écriture.
- `2026-09-14T13:41Z` — OCR #52:2 : un scan local de densité moyenne relu deux fois visuellement, transcription japonaise exacte produite ; SHA-256 et Sharp valides, `verifie` 1/1 et dépôt simulé 1/1, zéro écriture sous gel.
- `2026-09-14T13:48Z` — cinq fiches wiki supplémentaires ancrées via `databooks_planches` et `wiki_search` du MCP Dragon Ball : neuf sources exactes, cinq révisions, trois faux positifs explicitement rejetés ; résiduel 335.
- `2026-09-18T00:00Z` — régression de la baseline RAG constatée à 79,1 % Recall@5 puis corrigée : le rappel exact conserve les expressions numérotées et fait primer le sujet explicitement écrit sur les alias. Validation : 172/172 sources et Recall@5 80,2 % (`--lexical-only --validate --ci`), tests RAG et type-check bot verts. Audit PostgreSQL wiki différé : authentification locale invalide, aucun secret exposé.
- `2026-09-18T00:20Z` — audit wiki reconnecté à la réplique distante autoritative, avec prise en charge explicite des tables absentes et schémas sans colonne `visible` (plus de faux échec d'audit). Écarts réels mesurés sans écriture : 14 articles personnages, 22 bibliographies personnages, 15 noms JA techniques, 16 romaji, 8 types, 13 images techniques, 8 métadonnées JA d'épisodes et 10 jeux de pages databook manquent encore. La réplique configurée pour Vercel s'avère partielle (58 personnages / 659 épisodes / table databooks absente) et ne doit pas servir de preuve de couverture.
- `2026-09-18T00:35Z` — ré-ancrage canonique vérifié puis appliqué sur six personnages dont la prose existait sans bibliographie : Kaiô de l'Est, Kaiô Shin Nord/Sud/Ouest, Shallot et Ten Shin Han. Six révisions transactionnelles créées ; contrôle après écriture : 1 245/1 261 bibliographies personnages, résiduel de cette tranche = 2 correspondances ambiguës, laissées intactes.
- `2026-09-18T00:50Z` — cinq articles personnages manquants déposés avec preuves manga et révisions : Son Goku (chap. 1/199 + chronologie), Lunch (chap. 27), Majin Boo pur (chap. 508), Zabon (chap. 262) et Jeese (chap. 273). Audit distant après écriture : articles personnages 1 247→1 252/1 261 ; aucun texte inventé ajouté. Les fiches avec description mais sans article restent à traiter par preuves primaires.
- `2026-09-18T01:05Z` — article court de Dai Kaiô ajouté depuis une planche manga primaire (tome 37, planche 89), révision créée. Audit distant : articles personnages 1 253/1 261, bibliographies 1 245/1 261 ; 470/480 databooks ont des pages. Les fiches sans source primaire exploitable restent non publiées/en attente.
- `2026-09-18T14:20Z` — six articles personnages supplémentaires déposés et versionnés avec preuves primaires : Trunks du futur (tome 28), Kaïo du Nord (chap. 211), Vieux Kaïo Shin (chap. 471/503), Marcarita (chap. 28/30), Dai Kaio Shin (V Jump 2014 + chap. 498) et Zen-o (chap. 28). Audit distant : articles 1 259/1 261, bibliographies 1 251/1 261. Kaïo de l’Ouest et Âbra restent en attente, faute de preuve primaire non ambiguë trouvée.
- `2026-09-18T14:45Z` — détecteur d’hallucinations rendu compatible avec la base distante (priorité à `DATABASE_URL`, puis `REMOTE_DATABASE_URL`, sans secret affiché). Audit lecture seule : 16 402 planches, 108 boucles OCR longues, 14 courtes, 2 sérialisations JSON et 3 balisages survivants. Le correcteur déterministe propose 108 coupes, mais son dépôt HTTP est reporté car le site éditorial local (127.0.0.1:3000) n’est pas joignable ; aucune donnée n’a été supprimée ni remplacée sans révision.
- `2026-09-18T15:20Z` — correcteur OCR basculé vers des transactions PostgreSQL directes avec contrôle de concurrence et `wiki_revisions` par planche. 108 boucles artificielles, 1 compteur hangul, 3 balises HTML/échappements et 1 queue JSON ont été nettoyés et versionnés. Recontrôle : toutes ces familles sont à zéro ; seules 297 transcriptions courtes restent signalées pour relecture humaine (aucune règle sûre ne permet de les inventer ou compléter).
- `2026-09-18T15:35Z` — ajout du garde-fou testé `retirerBalisesHtml` et harmonisation des libellés de correction ; le type-check Site passe désormais (code 0). Les familles de faux artefacts restent à zéro au recontrôle.
- `2026-09-18T15:50Z` — article Kaïô de l’Ouest déposé depuis Chōzenshū 4, planche 65 ; audit distant : 1 260/1 261 articles et 1 252/1 261 bibliographies. Âbra reste explicitement en attente faute de source primaire exploitable. Le contrat SQL/UI wiki a aussi été audité sur 33 tables : 0 divergence.
- `2026-09-18T16:05Z` — file de relecture databooks reconnectée à la base distante ; inventaire vérifié : 17 remplacements, 113 alphabets étrangers, 720 pages sans kana, 90 boucles, 157 courtes et 688 vides, plus 280 emplacements sans scan. Les pages courtes restent en attente d’image et ne sont pas complétées par invention ; le test no-404 est sans échec (tests live non activés).
- `2026-09-18T16:15Z` — passe UI statique : contrat de contribution, audit du contrat wiki et accessibilité des formulaires publics passent (5 tests, 0 échec). Les tests no-404 restent explicitement ignorés tant que le site live n’est pas activé.
- `2026-09-18T16:30Z` — couverture personnages désormais complète sur les fiches visibles : 1 260/1 260 articles et 1 260/1 260 bibliographies. Kibitoshin et les trois guerriers Nameks ont été resserrés sur leurs preuves manga ; Âbra, dont la description contredisait la source Daima et n’avait aucune preuve primaire, a été retiré logiquement (`visible=false`) avec révision. Audit couverture + contrats/UI : 9 tests pass, type-check Site OK.
- `2026-09-18T16:45Z` — neuf sections PWS de Son Goku contenant des échelles spéculatives non sourcées ont été retirées logiquement et versionnées. Le pack PWS public retombe sur son état transparent « à compléter » ; aucune donnée chiffrée fabriquée ne reste visible. Vérification : 0 section PWS visible, 8 tests wiki pass, type-check Site OK.
- `2026-09-18T17:05Z` — l’audit structurel des articles wiki (toutes tables modérables) est maintenant raccordé à la base distante et retourne 0 anomalie : aucune bibliographie manquante, URL de wiki-fan ou tournure spéculative. La fiche Butta (5 458 signes de prose non sourcée, GT/films/jeux et source auto-référente) a été remplacée par 242 signes manga sourcés (chap. 273/281). Audit personnages maintenu à 1 260/1 260 articles et sources.
- `2026-09-18T17:25Z` — 344 variantes de personnages portant le placeholder non factuel « Niveau canonique de l’époque » ont été retirées logiquement et versionnées. Il reste 107 variantes visibles avec données spécifiques et preuves manga/databook ; aucune variante visible ne repose encore sur le générateur `synopsis-episodes`.
- `2026-09-18T17:40Z` — 29 variantes supplémentaires sans aucun tome/scan manga, générées uniquement depuis des synopsis d’épisodes (paliers divins, GT/Daima et profils génériques), ont été retirées logiquement et versionnées. Il reste 78 variantes visibles, toutes avec preuve tome/planche structurée.
- `2026-09-18T17:55Z` — audit structuré des variantes terminé : 78 visibles, 78 avec au moins un tome/scan manga dans `evidence`; les 29 entrées synopsis-only ont été retirées. Les 50 niveaux de puissance visibles restants sont limités aux sources `scouter_manga`, `daizenshuu_7` et `kiri_babidi`.
- `2026-09-18T18:10Z` — métadonnées d’identité planètes complétées et versionnées uniquement quand la forme japonaise était déjà attestée par les fiches liées : Planète Namek (`ナメック星`, `Namekku-sei`) et Moro (`Moro`). La race « Personne-cœur (Daima) » reste inchangée faute de preuve primaire explicite ; aucun nom japonais n’a été inventé.
- `2026-09-18T18:35Z` — 53 articles de techniques contenant le gabarit de jeu `## Aperçu` et des commandes `[BTN_*]` ont été nettoyés : description, prose et bibliographies falsifiées retirées, identité des techniques conservée, 53 révisions transactionnelles créées. Recontrôle distant : 0 marqueur `## Aperçu` et 0 `[BTN_*]` visibles.
- `2026-09-18T18:45Z` — contrôle lexical complémentaire des techniques : aucune variante résiduelle (`commande`, `endurance`, `appuie`, etc.) ; correction de typage du script puis `bun --filter @shenron/site type-check` et `oxfmt` réussis.
- `2026-09-18T19:05Z` — quatre arcs audités pour citations de jeux : trois ont perdu 6 entrées Xenoverse/« compétences » tout en conservant leurs sources manga/épisodes ; « Golden Freezer », privé de toute preuve restante, a été retiré logiquement et versionné. Recontrôle : 0 source Xenoverse visible, type-check Site OK.
- `2026-09-18T19:25Z` — balayage global des personnages, planètes, races et sagas : 47 fiches ont perdu des citations Xenoverse/Dokkan/FighterZ ou « compétences/répliques » de jeu ; les preuves canoniques restantes sont conservées, et les fiches sans aucune preuve sont masquées logiquement. Recontrôle : 0 citation de jeu visible dans ces quatre tables ; type-check Site OK.
- `2026-09-18T19:45Z` — 34 bibliographies visibles encodées à tort comme chaînes JSON ont été converties en vrais tableaux JSON et versionnées (28 personnages, 1 planète, 1 saga, 1 race, 3 arcs). Recontrôle structurel : 0 `jsonb_typeof(article_sources)=string` visible ; type-check/oxfmt OK.
- `2026-09-18T20:05Z` — 45 arcs sans article ont été retirés logiquement et versionnés pour ne plus exposer de pages vides. Il reste 19 arcs visibles, tous avec un article ; recontrôle `empty_visible=0`, type-check Site OK.
- `2026-09-18T20:25Z` — 32 fiches contenant des citations de chapitres impossibles (numéros 1347–1415) ont perdu ces références ; Bardock, Cell Max et l’arc Tournoi du Pouvoir, privés de preuve restante, ont été masqués logiquement. Recontrôle : 0 citation impossible visible, 18 arcs visibles tous sourcés, type-check Site OK.
- `2026-09-18T20:35Z` — la suite Site complète a été relancée : 1 003 succès, 7 skips et 89 échecs d’intégration tous dus à l’authentification PostgreSQL locale `shenron` (`127.0.0.1`), non à une assertion UI ; le type-check distant reste vert.
- `2026-09-18T20:50Z` — les 53 techniques restantes sans article ni bibliographie, issues des gabarits de jeu purgés, ont été masquées logiquement et versionnées. Audit transversal : 0 page vide visible dans personnages, planètes, techniques, sagas, races, arcs et transformations ; type-check Site OK.
- `2026-09-18T21:15Z` — 576 marqueurs de gabarit `## Aperçu` ont été retirés des articles personnages/saga (contenu sourcé conservé, révisions créées). Recontrôle : 0 marqueur `[BTN_]`, `## Aperçu`, `PLACEHOLDER` ou `Lorem ipsum` visible ; type-check/oxfmt OK.
- `2026-09-18T21:45Z` — 108 personnages dont l’article déclarait une exclusivité au jeu vidéo ou au mode histoire FighterZ ont été retirés logiquement et versionnés ; les fiches manga/anime conservées restent complètes. Recontrôle : 0 exclusivité jeu visible, 1 134 personnages visibles, 0 article vide ; type-check Site OK.
- `2026-09-18T22:05Z` — 86 personnages supplémentaires décrits comme EX-Fusion, Heroes ou exclusifs à un jeu, sans aucune source manga/anime/film, ont été masqués logiquement et versionnés. Recontrôle : 13 mentions résiduelles disposent d’une preuve primaire forte, 1 048 personnages visibles, 0 article vide ; type-check Site OK.
- `2026-09-18T22:25Z` — 58 fiches dont le premier paragraphe revendiquait une origine vidéoludique (EX-Fusion, Heroes, FighterZ ou jeu exclusif) ont été masquées logiquement et versionnées. Recontrôle : 990 personnages visibles, 0 article vide ; les mentions de jeux restantes sont contextuelles ou adossées à des preuves éditoriales, type-check Site OK.
- `2026-09-18T22:45Z` — 201 fiches visibles ont reçu une réécriture versionnée des anciens liens `/wiki/dragon-ball/...` et `/wiki/planetes/...` vers les routes canoniques `/wiki/personnages`, `/wiki/cosmologie`, `/wiki/techniques` et `/wiki/jeux`. Recontrôle transversal : 0 ancien préfixe visible ; type-check Site/oxfmt OK.
- `2026-09-18T23:05Z` — 326 fiches personnages contenant le boilerplate générique « personnage du vaste univers Dragon Ball créé par Akira Toriyama » ont été retirées logiquement et versionnées ; aucune prose générée non sourcée ne reste visible.
- `2026-09-18T23:20Z` — audit des médias wiki : les cinq dragons sacrés et Mafūba étaient sans visuel. Quatre images canoniques déjà présentes dans `public/wiki/characters` ont été rattachées aux dragons (Shenron, Polunga, Super Shenron, Toronbo) ; Mafūba reçoit le portrait existant de Muten Roshi. Le registre dragons affiche désormais ces assets et chaque fiche tournoi réutilise la bannière canonique de sa catégorie ; révisions PostgreSQL créées.
- `2026-09-18T23:35Z` — audit de régression OCR relancé : toutes les familles bloquantes restent à zéro ; les 17 remplacements japonais, 419 intrusions d’alphabet et 297 transcriptions courtes restent signalés pour relecture humaine, sans correction automatique destructive. Le chemin Mafūba a été normalisé vers l’asset local `/dbz/characters/master-roshi.webp`; type-check Site OK.
- `2026-09-18T23:55Z` — garde canonique transversale appliquée aux catégories d’expansion : 112 pages visibles sans article ni bibliographie (27 objets, 15 lieux, 6 tournois, 47 combats, 8 voix et 9 musiques) ont été masquées logiquement et versionnées au lieu d’exposer des fiches générées non prouvées. Audit articles : 0 anomalie ; type-check Site OK.
- `2026-09-19T00:10Z` — le registre des dragons utilise maintenant la bannière de catégorie comme fallback visuel explicitement décoratif pour une fiche dépourvue d’asset propre (Ultimate Shenron), sans attribuer une image étrangère au dragon. Le fallback est partagé avec le hero (une seule résolution), tests bannières/images : 10 succès ; type-check OK.
- `2026-09-19T00:20Z` — contrat SQL wiki revalidé après la purge logique des catégories : les 33 tables éditoriales restent présentes avec leurs colonnes attendues ; aucune lecture publique ne pointe vers une table supprimée.
- `2026-09-19T00:45Z` — six tournois canoniques ont été restaurés avec des articles courts fondés sur les tomes manga existants ; les compteurs et tableaux de matchs non sourcés ont été neutralisés. Les liens de sources des dix tournois visibles ont ensuite été réalignés vers les IDs réels de `db_manga_volumes` (84–133), supprimant les anciennes URLs invalides 150/153. Audit articles : 0 anomalie ; type-check OK.
- `2026-09-19T01:05Z` — les 20 lieux encore visibles (après le garde-fou de preuves) ont reçu un mapping visuel explicite par planète/royaume dans `LocationsGrid` : Namek, Sadala, Vampa, Monde du Vide, Makai et lieux terrestres ne retombent plus silencieusement sur une image incohérente. Tous les fichiers référencés existent ; 10 tests images/bannières et type-check passent.
- `2026-09-19T01:25Z` — 4 998 sections `db_wiki_sections` orphelines de personnages masqués ont été retirées logiquement en une transaction SQL et versionnées. Recontrôle structurel : 0 section visible sans parent, 0 section visible vide.
- `2026-09-19T01:45Z` — cinq objets fondamentaux (Dragon Radar, Capsules Hoi-Poi, Senzu, Nyoï-bô, Kinto-Un) ont été restaurés avec articles courts et références manga valides ; les 22 fiches restantes sans preuve demeurent masquées. `ItemsGrid` affiche désormais un fallback visuel de catégorie, et le Kinto-Un utilise son asset local. Audit : 5/5 articles et sources visibles ; 21 tests UI pass, type-check OK.
- `2026-09-19T02:00Z` — les cartes de l’index des tournois utilisent maintenant la bannière canonique de catégorie comme visuel décoratif partagé avec le hero ; aucune carte de tournoi ne reste sans asset dans l’interface. Type-check et 14 tests bannières/design passés.
- `2026-09-19T02:20Z` — les 15 fiches musicales visibles reçoivent aussi un visuel décoratif de catégorie partagé avec le hero ; l’interface ne présente plus de cartes audio sans asset. Type-check et 14 tests bannières/design passés.
- `2026-09-19T02:45Z` — passe qualité UI/lint : imports inutilisés supprimés des fiches databook/manga, tests d’intégration et scripts de collecte nettoyés, expressions régulières sans échappements inutiles corrigées. Lint, type-check et `git diff --check` terminés sans sortie d’erreur.
- `2026-09-19T03:20Z` — audit des bibliographies visibles étendu aux 17 tables : 16 fiches ont reçu une réécriture versionnée des liens de sources legacy (technique/movie) et des IDs de volumes manga. Recontrôle distant : 0 URL `/wiki/dragon-ball/` ou `/wiki/planetes/`, 0 ID `/wiki/manga/volume/` invalide.
- `2026-09-19T03:35Z` — les 5 liens de films encore numériques dans les bibliographies ont été résolus vers les slugs `db_movies` canoniques, avec révisions versionnées. Recontrôle distant : 0 ancien préfixe, 0 URL `/wiki/films/<id>`, 0 volume manga invalide ; type-check, 17 tests UI ciblés et `git diff --check` OK.
- `2026-09-19T04:05Z` — audit anti-fausse donnée : l’article de la Planète de Maître Kaïô a été réécrit sur les seuls tomes 18 et 27 (suppression des anecdotes non sourcées Beerus/Gregory), et ses sources sont désormais `/wiki/manga/volume/99` et `/wiki/manga/volume/108`. La passe d’intégrité a aussi reconstruit 506 bibliographies visibles stockées comme chaînes JSON en vrais tableaux, avec révisions. Recontrôle : 0 format invalide, 0 ancien lien, 0 film numérique, audit articles 0 anomalie, contrat SQL/type-check/git diff OK.
- `2026-09-19T04:20Z` — inventaire de migration demandé : 29 fiches `Jump Anime Comics` restent visibles dans `db_databooks`, tandis que 59 volumes Anime Comics sont déjà dans `db_manga_volumes` (`DBZ_ANIME_COMICS` + `DB_MOVIES`). Aucune suppression appliquée sans les 3 exceptions éditoriales ; 23 modules/pages référencent encore `/wiki/cosmologie`, donc une dépublication doit passer par redirections et retrait de navigation, pas par suppression physique.
- `2026-09-19T04:45Z` — migration exécutée après autorisation : 18 doublons Anime Comics certains (`db_databooks` 32, 33, 48, 312, 443–456) masqués logiquement, chacun versionné et redirigé vers son volume `DB_MOVIES`/TVSP Manga (404–420). Les 11 fiches non équivalentes restent dans Databooks. La rubrique Cosmologie a été retirée de la navigation et du sitemap ; `/wiki/cosmologie` et ses anciennes fiches redirigent vers `/wiki/lieux`, sans suppression physique des données. Type-check OK, lint 0 erreur (2 avertissements préexistants), 16 tests ciblés passés.
- `2026-09-23` — balayage des gates CI : `bun run test:ci` était rouge (2 scopes, 3 tests) car deux suites unitaires exigeaient des binaires externes absents des runners (`bxc`, `aphrody`). Le tier unitaire bot route désormais `BXC_BIN` vers la fixture CLI déterministe de `@shenron/pipeline/bxc` (qui répond aussi à `--version`), le binaire réel restant couvert par le tier `--live` ; le test gix de `@shenron/pipeline/aphrody` n'exige un HEAD que si le FFI ou le CLI est résolvable et vérifie sinon l'échec structuré (`ok=false`, `head=unknown`). Résultat : 10 scopes pass / 0 fail / 3 skip (bot 295 pass, aphrody 34 pass) ; `check:catalog`, `type-check` (6/6), `lint` (4/4, 0 erreur) et `git diff --check` verts.
## 2026-09-19T05:00Z — Migration Sōshūhen/light novels et rapport Omar

- 18 Databooks Sōshūhen (465, 469–485) masqués logiquement et reliés aux volumes Manga 701–718 déjà présents.
- 2 light novels (Databooks 58–59) importés en volumes Manga 719–720 (`DB_LIGHT_NOVELS`), puis masqués côté Databooks.
- 20 redirections permanentes Databook → Manga ajoutées ; aucun fichier ni contenu supprimé physiquement.
- Rapport complet de session envoyé en DM à Omar (`1527405876695142620`), en 4 messages.
## 2026-09-19T05:15Z — Corpus Xeno conservé séparément

- Restauration logique de 8 fiches Xeno officielles suffisamment documentées (Demigra, Mira, Towa, Aeos, Ahms, Beat, Bardock Xeno, Broly Xeno), avec révisions et distinction explicite du canon manga/anime principal.
- Les fiches courtes/génériques restent masquées jusqu’à enrichissement sourcé ; aucune donnée supprimée.
- Mise à jour DM envoyée à Omar (message Discord `1550546695417233471`) sur la séparation future en page Xeno à onglets.

## Exploitation transverse migrée vers Infra du monorepo — 2026-09-23

- `deploy/systemd/shenron-zswap.service` → `systemd/` (réglage hôte) ;
  `deploy/setup-swap.sh` l'installe depuis `../../systemd/`.
- `scripts/ops/ovh-dns.ts` → `scripts/ops/ovh-dns.ts` (doublon du client OVH de nie).
- Restent ici, car liés aux releases Shenron : sauvegardes, `clean-vps`, `watchdog.sh`,
  `healthcheck.sh`, `install.sh`.
- Gate : `bun test apps/site/tests/deploy-site-invariants.test.ts` → 11 pass, 0 fail.

## Unification de la stack — 2026-09-24

Mise à jour du 2026-09-29 : les imports `@aphrody/m3-next` et
`@aphrody/canvas` ont été retirés. Le site utilise sa configuration Next
directe et le bot utilise `@napi-rs/canvas` 1.0.9. Les paquets Discordx
viennent du registre au lieu du checkout `aphrody-discord`. Le contrôle
`check:packages` interdit désormais les dépendances de code Shenron vers
`@aphrody/*` et les workspaces `../aphrody-*` ; les clients Aphrody consomment
les contrats Shenron.
Le code propriétaire Aphrody Discord a pour cible le monorepo
`` selon son `PLAN.md` ; Shenron ne l'intègre pas dans
son workspace. Les bibliothèques Discordx publiées restent des dépendances
tierces du bot.

- Décisions (SH-P1-016) : TypeScript 7.0.2 partout (`next build` passe par `experimental.useTypeScriptCli`, défaut de Next 16.3.5) ; ESLint retiré au profit d’oxlint (typescript-eslint plafonne `typescript <6.1`) ; Drizzle 0.45.3 avec postgres-js (site) et Bun.SQL (bot, scripts, API) ; Better Auth 1.7.5 ; Hono 4.13 + zod-openapi 1.6 monté dans les processus existants (pas de nouvelle unité) ; Vercel AI SDK v7 devant `aphrody-ai-http` ; Base UI 1.8 + Tailwind v4 ; canvas = version aphrody-os de `@aphrody/canvas`.
- Recherche : cartes des surfaces (6 lecteurs + critique), scan Aphrody (4 scanners, 2 vérificateurs), panel de 3 architectures et 2 juges → `design/aphrody-m3/packages/material-web/docs/STACK.md`.
- Canvas : `@aphrody/canvas@1.0.9-aphrody.2` publié depuis aphrody-os `208db180` ; bot : `apps/shenron/bot/tests/canvas-render.test.ts` 5/5 en natif sous win32, suite bot 306 pass / 1 skip / 0 fail.
- Préparation orchestrateur : catalogue (retrait ESLint, `@ai-sdk/react`, `@modelcontextprotocol/sdk` ; ajout `@ai-sdk/provider`, `postcss`), squelette `@shenron/config`, manifestes des paquets ; `bun install --frozen-lockfile` : 1 336 installations, aucun changement.
- Vagues 1 à 3 livrées (`eae47eeb` → `47ef816d`) : `@shenron/config`, `db`, `auth`, `ai`, `aphrody` (source-first), `ui` (Base UI), `api` (contrat OpenAPI, client, serveur Hono) ; site et bot branchés sur les paquets. Typecheck site/bot vert ; paquets : db 79, auth 93, ai 107, aphrody 53, ui 26 tests, 0 échec ; bot 376 pass / 1 fail intermittent (`rag-filter.test.ts`, planches manga) / 1 skip. Restent vagues 4 (api, auth, ai, ui) et 5 (outillage).
- Runtime : option C retenue (`b50b4f6b`, `docs/architecture/shenron/RUNTIME.md`) — `shenron.target` + un runtime applicatif, site séparé ; unités et tickets côté aphrody-infra.
- Dev local : `scripts/dev/shenron/scripts/dev/local-env.ts` (`5e1d35e9`) génère `apps/{site,bot}/.env.local` (dédoublonné, sans `NODE_ENV`) et ouvre les tunnels depuis le catalogue aphrody-infra (Windows et WSL) ; `next build` vert dans WSL. Cause du prérendu cassé : `NODE_ENV=development` hérité du `.env` racine. Cf. `docs/operations/shenron/DEV-LOCAL.md`.

## Traduction databooks — arrêt propre et reprise — 2026-09-25

- La chaîne centralisée est livrée : Aphrody `ja→fr` one-shot, lexique japonais
  et juges Shenron, dépôt PostgreSQL atomique, puis ingestion RAG idempotente.
  Les marqueurs Aphrody sont à largeur fixe (`QXZ0001`) et le scan UTF-8 long a
  été corrigé dans Aphrody (`d2378c84`).
- La session `databook-translation-20260924235829` a été arrêtée sur demande
  après la fin des lanes 1 et 2 ; son manifeste est `stopped`, les processus
  Bun et le tunnel SSH ont été vérifiés absents. L'ingestion RAG a été relancée
  seule ensuite et a terminé avec 24 775 documents et 10 286 traductions.
- Mesure PostgreSQL finale : 17 369 pages, 16 402 transcriptions japonaises,
  11 318 traductions françaises ; 2 556 pages restent éligibles et 2 528 sont
  bloquées par la qualité OCR/source. Statut global : `INCOMPLET`.
- Vérifications : 62 tests databooks, 0 échec ; build Bun des scripts centralisés
  vert. Le workspace Cargo Aphrody complet reste bloqué par un conflit externe
  `wasm-bindgen`, mais le crate de traduction isolé a passé 21 tests et son build
  release.
