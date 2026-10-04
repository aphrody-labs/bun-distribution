# Plan de raccordement Shenron–Aphrody : reste à faire

## Mise à jour — 2026-09-27

### État réel vérifié le 2026-09-27

Les états ci-dessous proviennent de sondes exécutées depuis `shenron` et
Infra du monorepo; ils remplacent les chiffres historiques qui ne sont pas
explicitement marqués comme live.

| Surface | État observé | Preuve |
| --- | --- | --- |
| Poste local | FAIT | `bun scripts/dev/local-env.ts env` a généré les `.env.local` du site et du bot avec les variables canoniques et les ports du catalogue. |
| Tunnels | FAIT au dernier contrôle | `bun scripts/dev/local-env.ts status` : PostgreSQL `15433`, Aphrody HTTP `18789`, embed `18794`, bot `15006`, MCP `15010`, Redis `16379` UP. |
| Shenron doctor | PARTIEL | SQLite, index, corpus, CUDA/RTX 4070 et modèles locaux détectés ; la source PostgreSQL du binaire Aphrody reste non configurée et le diagnostic retombe sur SQLite. |
| RAG local | FAIT lexical, INCOMPLET vectoriel | 28 583 passages : 24 805 databooks, 3 771 wiki, 7 canon. L'évaluation sans sidecar E5 reste en BM25 : Recall@5 9,3 %, 156 misses sur 172. |
| Embedder distant | INCOMPLET | Le tunnel peut être UP, mais `/health` du sidecar E5 n'a pas répondu pendant le contrôle ; aucun gain hybride ne doit être déclaré. |
| Services VPS | INCOMPLET | Le catalogue Infra du monorepo indique `shenron-site` et `shenron-bot` actifs ; les services Aphrody HTTP/embed/A2A restent inactifs, car le bundle Aphrody est encore marqué retiré. |
| Build site | INCOMPLET | Turbopack compile et collecte la PostgreSQL distante ; la génération de 1 861 pages n'a pas produit de preuve finale stable après perte d'un run de tunnels. |
| Traduction databooks | INCOMPLET | Le registre admin du 2026-09-25 reste la source éditoriale : reprise OCR/source et 2 556 pages éligibles à superviser ; aucun dépôt de masse automatique n'est considéré comme fait. |
| Authentification souveraine | FAIT | `aphrody shenron auth test --site https://dragonballfr.com` : 3 canaux validés HTTP 200 (AgentKey Bearer, cookie HMAC dbfr_admin 30j, session Better Auth Bearer). Formulaire sécurisé sans secret dans l'URL. |
| Cadre 7 Piliers | DÉPLACÉ | Document cross-repo désormais détenu par `../aphrody-ai/docs/ROADMAP-AGENT-PILLARS.md`; ses métriques historiques doivent être rafraîchies par les propriétaires avant usage opérationnel. |

Conséquence : le pont couvre les surfaces documentées; ce tableau du 2026-09-27 ne constitue pas une vérification live renouvelée. La publication Aphrody complète, le RAG vectoriel et la reprise éditoriale des databooks restent à contrôler via les dépôts propriétaires et Infra du monorepo. La feuille de route partagée est dans `../aphrody-ai/docs/ROADMAP-AGENT-PILLARS.md`. Aucune valeur de secret, identifiant de compte ou jeton n'est documenté ici.

- [x] Les changements locaux du pont ont été livrés dans Shenron
  (`71158a45`) et Aphrody AI (`8f19bc2`). La façade FFI native expose la
  recherche lexicale avec contenu, langue et source ; elle ne prouve ni un
  mode vectoriel ni la présence de pages de manga dans l'index.
- [x] Le client `@shenron/pipeline/aphrody/native` consomme aussi `shenron_auth_status`
  et ne restitue que les indicateurs `configured` et
  `adminCredentialsPresent`, sans exposer de valeur d'identifiant.
- [x] Lacune wiki réelle traitée : la fiche Guldo (`db_characters`, id 83),
  sans bibliographie, a reçu six références primaire/databook par le script
  de ré-ancrage contrôlé. La relecture PostgreSQL a confirmé six sources ; le
  texte de l'article n'a pas été réécrit.
- [ ] La release active, les services live, le contrat MCP en production et
  la fraîcheur/couverture globale du RAG restent à vérifier via
  Infra du monorepo. Le succès de l'écriture PostgreSQL ne prouve pas la
  publication de code ou la mise à jour de l'index RAG.

Établi le 2026-09-27 à partir des sondes et de la lecture des documents et du code de
`shenron`, `aphrody-ai` et Infra du monorepo. Ce plan distingue les changements
locaux déjà réalisés des contrôles qui exigent une release ou un runtime live.
Les chiffres issus des rapports datés sont des repères historiques à
recomptabiliser avant toute reprise.

## État de départ

- [x] Le MCP Dragon Ball est porté par `aphrody-ai/crates/aphrody-mcp` et le
  plugin Shenron pointe vers le serveur local stdio `aphrody-mcp`.
- [x] Les docs, contrats de test et constantes Shenron ont été mis à jour pour
  retirer la dépendance au registre Bun supprimé `apps/shenron-mcp` (not in repo).
- [x] Les propriétaires sont clarifiés : Aphrody fournit le calcul, les outils
  et les modèles ; Shenron garde PostgreSQL éditorial, le jugement canonique,
  les juges métier et la publication.
- [ ] Les changements locaux du dépôt restent à relire et livrer ; les sondes
  de production n'ont pas été exécutées dans le cadre de cet audit.

## Ordre d'exécution

### 1. Fermer et livrer le changement documentaire et plugin

- [ ] Relire le diff complet, notamment les références historiques dans
  `m3/packages/material-web/docs/STACK.md`, `docs/architecture/shenron/APHRODY-ECOSYSTEM.md` et le plugin, pour qu'aucun ancien
  MCP public ou paquet supprimé ne soit présenté comme actif.
- [ ] Exécuter les contrôles locaux ciblés du dépôt et vérifier les liens,
  manifestes JSON et contrats MCP.
- [ ] Livrer le changement sur `main` selon le flux Shenron, avec une seule
  ligne de commit conventionnelle en français si un commit est demandé.
- **Preuve de sortie :** diff propre, contrôles ciblés réussis, commit ou état
  local explicitement consigné.

### 2. Établir la vérité de la release et des services

- [ ] Lire le catalogue courant et les contrats d'application dans
  Infra du monorepo; déterminer quelles versions de Shenron et Aphrody sont
  réellement déployées.
- [ ] Vérifier par sondes en lecture seule les services Shenron site/bot,
  l'API `aphrody-ai-http`, l'embed et les routes utiles. Les unités, hôtes,
  routes et releases sont la responsabilité d'Infra du monorepo.
- [ ] Comparer les versions live au code modifié. Ne pas reconstruire une
  ancienne unité MCP publique retirée.
- **Preuve de sortie :** version/release active, résultats des sondes et
  capacités répondantes, datés et sourcés par infra.

### 3. Prouver le contrat MCP du plugin

- [ ] Construire ou localiser le binaire `aphrody-mcp` avec les outils
  Dragon Ball, puis vérifier `tools/list` contre le catalogue généré
  `docs/ecosystem/MCP-TOOLS.md`.
- [ ] Ouvrir une session stdio depuis chaque client déclaré par le plugin et
  effectuer des appels publics en lecture seule : recherche RAG, sources,
  couverture et lecture wiki.
- [ ] Vérifier que les outils d'administration refusent l'accès sans
  authentification et qu'aucun secret n'est embarqué dans les manifestes.
  Les écritures admin ne font pas partie de ce plan de vérification.
- **Preuve de sortie :** versions du binaire et des clients, liste des outils,
  exemples d'appels lecture seule et résultat du contrôle d'accès.

### 4. Vérifier les connexions Aphrody utilisées par Shenron

- [ ] Vérifier, sans afficher leurs valeurs, la présence des paramètres
  d'environnement `APHRODY_AI_HTTP_URL` et `APHRODY_AI_HTTP_TOKEN` côté
  runtime, puis appeler les endpoints de santé et de capacités.
- [ ] Confirmer séparément les parcours RAG, LLM, embeddings, OCR, vision et
  traduction. Consigner les fonctionnalités indisponibles plutôt que de les
  déduire d'un simple healthcheck global.
- [ ] Confirmer que le RAG renvoie son mode réel et que les embeddings
  respectent le modèle, la dimension et les préfixes attendus par Shenron.
- **Preuve de sortie :** matrice endpoint/fonctionnalité, mode RAG observé,
  modèle/dimension observés et erreurs résiduelles sans valeur de secret.

### 5. Recompter et remettre le RAG à niveau

- [ ] Relever les nombres actuels de documents, chunks, vecteurs et dates de
  fraîcheur. Les nombres des anciens rapports ne constituent pas un état live.
- [ ] Vérifier l'ingestion et le filtrage des espaces/sources Dragon Ball,
  puis corriger les documents manquants ou périmés via le flux de sync existant.
- [ ] Exécuter l'évaluation Shenron/RAG sur le jeu de référence après avoir
  confirmé qu'il correspond toujours au corpus et aux critères actuels.
- **Preuve de sortie :** compteurs avant/après, échantillons de récupération,
  fraîcheur et résultat d'évaluation reproductible.

### 6. Reprendre les databooks et traductions en attente

- [ ] Recompter les pages et lots en attente. Le rapport du 2026-09-25
  mentionnait 2 528 pages en quarantaine et 2 556 pages admissibles à la
  traduction ; ces volumes sont historiques jusqu'à vérification.
- [ ] Pour les pages en quarantaine, lancer d'abord le diagnostic et
  l'émission OCR, puis faire vérifier les sorties et les sources par les juges
  Shenron et une revue visuelle des cas incertains.
- [ ] Pour les pages admissibles, reprendre les traductions par lots
  supervisés, contrôler le lexique japonais, les citations et les rejets,
  puis réindexer les contenus acceptés.
- [ ] N'effectuer aucun dépôt de masse avant validation des lots et du flux
  éditorial. Les commandes `deposit --apply` et `pipeline --apply` écrivent
  dans les données ; les garder derrière un lot explicitement revu.
- **Preuve de sortie :** manifeste des pages, provenance des images, résultats
  des juges, revue des exceptions, révisions déposées et état de réindexation.

### 7. Fermer les contrats collecte et délégation A2A

- [ ] Comparer le contrat live de l'API Web/BXC au collecteur Shenron et
  confirmer le découpage en chunks et la recherche sur un petit échantillon de
  sources primaires autorisées. La provenance et l'import éditorial restent
  sous contrôle Shenron.
- [ ] Vérifier le routage A2A vers le hub du site, les identités et le
  transport d'authentification. L'ancien client MCP n'acheminait pas à lui
  seul `SHENRON_A2A_TOKEN` ; ne pas activer une enforcement stricte avant une
  preuve de bout en bout.
- [ ] Tester d'abord lecture/health/ping et une tâche sans écriture ; suivre
  chaque tâche jusqu'à son artefact final.
- **Preuve de sortie :** réponse API et chunks récupérés, ping A2A authentifié,
  tâche terminée avec artefact et identité du pair.

## Règles de clôture

- Une fonctionnalité documentée ou un outil présent dans `tools/list` ne
  prouve pas qu'il fonctionne dans la release live.
- Toute écriture éditoriale doit passer par les juges, la révision et les
  règles Shenron ; pas de suppression physique.
- Toute modification d'unités, routes, déploiement ou rétention relève
  d'Infra du monorepo.
- Fermer chaque point avec une preuve datée et un statut `FAIT`, `INCOMPLET`
  ou `NON_FAIT`.
