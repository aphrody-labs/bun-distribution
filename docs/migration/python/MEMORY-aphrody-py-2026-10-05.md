<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Python — mémoire factuelle

## Qualification Python et C ABI Yolo — 2026-10-04

Lot Python clôturé : adaptateur `aphrody.yolo_runtime` standard-library ctypes,
contrôles de distribution effectifs, licences Apache-2.0 et AGPL-3.0-only
préservées, migration de métadonnées idempotente. Aucun moteur Yolo modifié.

Gates actuelles : 695 tests passent, 22 ignorés en 24,14 s ; Ruff passe,
298 fichiers formatés ; Mypy passe sur 147 sources ; uv lock --check --offline
passe (243 packages). Les skips concernent extras absents, fixtures/providers
privés ou intégrations opt-in ; ils ne constituent pas des preuves.

Deux builds isolés de la distribution Python depuis sources natives épinglées
(direct et depuis sdist) produisent des wheels byte-identiques ; sources,
ressources, licences et provenance vérifiées. Deux installations hors checkout
passent les imports publics et calculs PyO3. Reçu complet
en mode worktree-snapshot : révision HEAD antérieure au commit de ce lot,
empreintes des entrées exactes incluses.

La wheel directe installée dans un troisième venv hors checkout passe les
22 tests C ABI sous Python -I : Linux x64, ABI 1.4, quatre familles actuellement
advertisées (stats, bench, process, HTTP). Révision producteur
0ade1c71ccb52bcc9d255188a252c28c5b789b48 ; détail dans le
handoff.
Quatre intégrations Python vers le vrai app-server installé passent en 2,51 s ;
le test consommateur Bun est désélectionné conformément au périmètre Python.

Stabilité qualifiée pour ces contrats et cette cible. Pas de preuve native
Windows/macOS/ARM64, de toutes les versions Yolo, des capacités réservées,
des extras ML/providers non exécutés ou d'une absorption Jan globale achevée.
Aucune publication, installation de runtime ni reprise des agents hors Python.

## Python ADK et portabilité — 2026-10-04

Périmètre maintenu Python uniquement ; agents Rust/backend et UI interrompus.
Le transfert Jan privé a été arrêté à la demande du propriétaire. Aucune reprise
des compilations, de l'installation ou de l'activation hors Python.

Le client natif existant porte les sessions ADK, les callbacks d'outils hôtes,
les permissions explicites, l'annulation et les images ; pas de second transport,
installeur ou magasin. Preuves et limites ADK.
Les RPC modèle/reset indisponibles restent explicitement refusés.

Découverte portable : argument/configuration puis PATH ; suppression des
répertoires Blender et versions figées, suffixe Windows natif, chemins avec
espaces et home étendu, erreur explicite pour un exécutable invalide. SessionDB
résout APHRODY_HOME à chaque construction. Aucun déplacement de magasin protégé.

Reçu de validation :
665 tests passent, 22 ignorés, 0 échec en 23,44 s ; Ruff passe, Mypy passe sur
146 fichiers. Résolution Windows/macOS simulée ; exécution native, wheels et
installation multiplateforme non qualifiées. Métadonnées de licence du nouveau
module ADK et wheel mixte restent à qualifier ; aucune publication.

Relevé : 2026-10-03, Linux, hôte `APHRODY`. Le plan conserve la
queue et le contrat Agent-First les décisions.
Mémoire fichier uniquement ; aucune synchronisation fournisseur revendiquée.

## Lot orchestration Agent-First

FAIT : module Bun importable, catalogue fermé, scripts racine sous uv verrouillé,
JSON stdout séparé des diagnostics stderr, durées monotones, codes et signaux,
ressources du processus direct. Types Bun 1.4.2 épinglés dans `bun.lock`.
Les compteurs natifs BigInt sont sérialisés en chaînes décimales exactes.

| Vérification exécutée | Résultat et portée |
| --- | --- |
| `bun test tools/workspace/cli.test.ts` | 5 pass, 0 fail, 28 assertions après correction BigInt |
| `bun run workspace:typecheck` | TypeScript 7.0.2, exit 0 |
| `oxlint tools/workspace` | exit 0 |
| `oxfmt --check tools/workspace package.json tsconfig.json` | 5 fichiers, exit 0 |
| `bun tools/workspace/cli.ts locks` | 3 vérifications uv lock réussies ; 143.047 ms sur une exécution avant correction des métriques |
| `bun run lint` | Ruff passe, 39.637 ms sur une exécution |
| `bun run fmt -- --check` | 285 fichiers formatés, exit 0 après correction des métriques, 20.150 ms |
| `bun run typecheck` | Mypy : 143 fichiers, exit 0, 194.784 ms |
| `bun run test` | 611 pass, 22 skip ; pytest 22.04 s, processus 22 992.661 ms |
| `bun install --frozen-lockfile` | exit 0, aucune modification de lock |
| Workspace `docs-links --root /home/aphro/aphrody-py --docs docs/architecture --json` | 1 document, 3 liens locaux, 0 cassé, exit 0 |
| `git diff --check` | exit 0 |

Les durées sont des observations isolées, pas une comparaison de performance.
La suite Python avait commencé avant la correction de sérialisation des ressources ;
la sortie JSON finale indiquait encore `{}` pour ce champ. Les tests Bun et
`fmt -- --check` ont qualifié la correction. Les raisons des 22 skips n'ont pas
été auditées dans ce lot ; ils ne comptent pas comme couverture validée.

Au terme du premier lot, INCOMPLET : packaging encore Python ; MCP/API/FFI non intégrés ; supervision,
annulation et boucle récursive non qualifiées. `build`/`apply` et `check` complet
avec distributions isolées non exécutés : aucune qualification de nouvelle wheel,
aucun build moteur ni déploiement dans ce lot. Les gates requises de l'orchestration
sont exécutées sans prétendre remplacer les gates de migration complète.

NON_FAIT : `aphrody-infra quality plan --repo aphrody-py --json` retourne 1 :
« dépôt non catalogué: aphrody-py (workspace consolidé: aphrody) ».
Le routage propriétaire doit être corrigé/qualifié dans un lot distinct ;
le module local ne remplace pas l'orchestrateur inter-dépôts.

Le reçu `aphrody-workspace plugins facts --name yolo` est `stale` ; le contrat
`~/.codex/YOLO-NHITL.md` annoncé par la skill installée est absent.
Les consignes actives AGENTS/PLAN, l'aide live et les sources priment.
Le reçu global n'a pas été rafraîchi : sa qualification complète sort de ce lot.
Les outils Aphrody de fichiers ne sont pas exposés dans cette session ; les
lectures/écritures génériques ont couvert cette lacune.

Jan a été consulté initialement sur son dépôt officiel, branche `main` non épinglée.
Le propriétaire a ensuite demandé son absorption complète depuis un fork privé
dans `vendor/`, avec comparaison du code sur toutes les surfaces et sans doublons.

## Lot supervision native

FAIT : le module appelle le SDK Yolo épinglé, sans implémenter un second
superviseur. Acquisition par le propriétaire Workspace avec archive/provenance
vérifiées ; pin SDK `27403350547d36ef208068df929bc4e2eeb22218`, SHA-256
`c81812ea13393c7e87853866ce2282539e438870d3c52a35c72293050a071d57`.
Le cache est ignoré, les wheels Python ne dépendent pas du checkout voisin.

Artefact installé vérifié avant chargement : ABI 1.4, Linux x64, source native
`0ade1c71ccb52bcc9d255188a252c28c5b789b48`, bibliothèque SHA-256
`ae14394bcfb291b9da4a4aa79acdcac2193f30966ae5672f02adf9f6b3ec695e`.
Aucune recompilation, installation ou activation d'un nouvel artefact natif.

Le schéma JSON 2 conserve codes natifs, signal Unix numérique, raison, budgets
et volume de sortie. Le SDK n'expose pas CPU/RSS enfant : `resourceUsage: null`.
Délai par défaut 30 min ; capture sans troncature plafonnée à 64 MiB par flux.
Annulation par AbortSignal ou SIGINT/SIGTERM CLI. Libération des handles/contexte
après arrêt du groupe et jonction des workers par le propriétaire natif.

| Vérification du lot | Preuve |
| --- | --- |
| `bun run workspace:test` | 12 pass, 0 fail, 56 assertions ; timeout, abort préalable et actif, dépassement de sortie, parent sortant avec descendant résistant à SIGTERM, prérequis runtime absent |
| `bun run workspace:typecheck` | exit 0 après ajout de la supervision |
| `oxlint tools/workspace` | exit 0 |
| `oxfmt --check tools/workspace package.json config/sibling-checkouts.json` | 7 fichiers, exit 0 après extension de la syntaxe timeout |
| `bun tools/workspace/cli.ts locks` | 3 locks passent, 150.859 ms, ABI 1.4 rapportée par le processus natif |
| `bun run lint` | exit 1 correctement propagé ; 7 erreurs dans les changements Python concurrents Gemma/Jan et leurs tests/CLI ; aucun de ces fichiers n'est modifié dans le lot supervision |
| `bun install --frozen-lockfile` | exit 0, SDK installé depuis le cache vérifié |
| Workspace `docs-links --docs docs/architecture --json` | 1 document, 4 liens, 2 chemins inline vérifiés, 0 cassé |
| `git diff --check` | exit 0 |

Limites : Linux seulement ; descendants quittant le groupe et SIGKILL du
superviseur hors qualification. Les zombies orphelins sont inactifs et leur
récolte appartient à init, pas au parent CLI. L'exposition distante et le quota
de concurrence restent ouverts. Aucun gain avant/après revendiqué.
## Coordination Jan — 2026-10-03

Le lancement A2A initial a été arrêté à la demande explicite du propriétaire :
la délégation utilise les sous-agents natifs Codex, sans A2A ni sous-processus
CLI d'agents. Le manifeste `ai.json` introduit pour ce lancement a été retiré.
Les trois groupes A2A et leurs descendants ont été vérifiés terminaux avant
la reprise des changements par les sous-agents natifs backend/protocoles,
UI web/desktop, Python client/sessions/ADK. Les chemins sont disjoints ; le
parent garde les manifests partagés et les gates d'intégration. Les workers
ne compilent pas Cargo et ne commitent pas. Les anciens reçus locaux `.coord/`
restent ignorés par Git. Aucun endpoint public ni registre de credentials ajouté.

Revalidation avant ces agents : 623 tests Python passés, 22 ignorés ; Ruff passe
et Mypy passe sur 145 fichiers. Cela ne prouve pas une absorption Jan complète.
La fabrique VPS historique est désormais interdite : le VPS est réservé à
l'exécution par le PLAN Yolo actuel. Une nouvelle fabrique reste à désigner.

## Déduplication IA et RAG — 2026-10-05

Adaptation NumPy des kernels rag-core unifiée, façades float32/float64 préservées
avec leurs précisions et seuils distincts. Aucun kernel Rust recopié ni modifié.
La façade UnifiedInferenceClient réutilise le client HTTP/Harmony existant :
endpoint requis (Jan loopback par défaut), historique/système/modèle transmis,
erreurs propagées, compteurs fournisseur ou estimations identifiés. Elle ne
passe plus par le sampler simulé. Migration et limites dans les
propriétaires IA.

Validation : 100 tests ciblés passent ; suite Python complète : 721 pass,
22 skip en 28,51 s ; Ruff check et format passent (305 fichiers), Mypy passe
sur 148 sources. Sept liens du document de propriétaires sont valides.
Les skips ne constituent pas une qualification ; aucun poids ni appel fournisseur
externe, aucune nouvelle wheel ni installation. Tests numériques sur l'extension
native déjà installée et HTTP réel loopback.

Yolo extrait ses calculs vectoriels purs hors Gemma, avec 38 tests/452 assertions,
types et lint/format passants. Aphrody conserve son code Rust : sa gate Cargo
memory est refusée localement (code 64, fabrique imposée), donc aucune suppression
native non qualifiée. Les anciens samplers Gemma et la convergence numérique
interlangage restent ouverts ; ce lot ne clôt pas la consolidation globale.

## Unification CLI, MCP et inférence — 2026-10-05

Le sampler Gemma et son client délèguent à UnifiedInferenceClient ; un seul
transport HTTP/SSE sert aussi Harmony. Les CLI/MCP partagent description modèle
et résumé d'échantillonnage ; HTTP transmet historique et paramètres au même
service, conserve les compteurs fournisseur et refuse sa propre URL comme upstream.
Les réponses/compteurs simulés, faux médias par compteurs et replis silencieux
vers le local sont retirés de ces chemins. Streaming réel, fermeture du flux et
lecture async hors event loop qualifiés sur loopback ; annulation d'une lecture
synchrone bornée par le timeout HTTP, pas d'interruption immédiate revendiquée.

Suite complète finale : 737 pass, 22 skip en 38,27 s ; Ruff check/format passent
(309 fichiers), Mypy passe sur 150 sources. Tests SDK, vrai subprocess CLI,
manager MCP et HTTP loopback couvrent mêmes requêtes/résultats, premiers deltas,
erreurs et compteurs. Onze liens du document de propriétaires passent.
Contrats et limites.

Yolo partage désormais son registre entre CLI/MCP/HTTP : 135 tests cœur et
43 tests ciblés passent (suites partiellement communes), TypeScript/lint/format
et mdBook passent. Rust reste bloqué par la fabrique occupée et son ancien pin
observé ; aucun job interrompu ni build local forcé. Les helpers ML/bench restants
ne sont pas une exécution native qualifiée. Pas de nouvelle wheel, installation,
poids chargés ni fournisseur externe appelé. La capture d'aide installée a une
absence explicite : aphrody-python ; les nouveaux CLI sont testés depuis source.
