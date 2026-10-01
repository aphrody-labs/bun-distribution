<!-- SPDX-License-Identifier: Apache-2.0 -->
# Shenron, BXC et Aphrody Web : état de migration

Audit réalisé le 2026-10-01 depuis le checkout Aphrody et le dépôt GitHub BXC.

## Source examinée

- Dépôt : <https://github.com/aphrody-code/bxc>
- Branche : `main`
- HEAD observé : `53503cdb78fe584b876ee9fdc892a9b578212885`
- État du checkout d’audit : propre, clone temporaire; aucun fichier source BXC modifié.

Le code BXC pertinent est toujours présent dans `src/cli/dragonball.ts`,
`src/crawler/dragonballfr.ts`, `src/crawler/mediawiki.ts`,
`src/crawler/wiki-service.ts`, `src/sources/dragonball.ts`,
`src/sources/shenron-canon.ts`, `src/archive/shenron.ts`,
`src/archive/dragonball-export.ts` et `src/mcp/server.ts` (outil
`bxc_dragonball_shenron`). Le pipeline Dragon Ball BXC combine encore collecte
Toei, actualités, catalogue Shenron, assets, dossier canonique et exports JSONL.

L’historique Git atteste une migration ciblée : `255cd1d` retire de BXC les
datasets VoirAnime et leur mapper. Il n’atteste pas le transfert global du
crawler ou des dossiers Shenron. `71a3c58` ajoute ensuite le crawler massif,
la synthèse site-vers-API et le dossier Shenron canonique; `d629625` les
documente. Le HEAD actuel expose toujours les surfaces ci-dessus. La présence
de nouvelles briques Rust/FI dans BXC ne constitue donc pas une migration de
propriété.

## Rapprochement des propriétaires

| Capacité utilisée par Shenron | Propriétaire Aphrody retenu | État |
| --- | --- | --- |
| Crawl Web générique et extraction HTML/Markdown | `aphrody-web-crawl`, `aphrody-web-extract`, `aphrody web` | Export JSON enrichi; filtres URL; chemin dédié MediaWiki ajouté; adaptateur du corpus Shenron remplace l’appel BXC pour `crawl universal`. |
| Navigation et pages protégées | Aphrody Web / Obscura browser | Capacité déjà exposée par `aphrody web browser`; pas de remplacement domaine spécifique nécessaire établi dans cet audit. |
| MCP Shenron | `crates/ai/mcp` | Outils Dragon Ball/Shenron dispatchés vers l’API Shenron; pas de second client Shenron pipeline trouvé. |
| A2A | `crates/os/a2a-coord` et listener | Contrat serveur durable en cours d’intégration; adaptateur Shenron en cours. |
| Traduction | crate `aphrody-translate` | Le site délègue déjà la traduction à Aphrody. `GoogleTranslateService` du pipeline est désormais un adaptateur du client `AphrodyTranslateService`; aucun repli réseau ni cache de traduction TypeScript ne reste dans ce service. |
| OCR databooks | `aphrody-ocr` via API Aphrody | Reconnaissance/revue distantes; Shenron reste le validateur et l’écrivain des transcriptions. |
| Infra | `aphrody-infra`, `@aphrody/workspace` | Adaptateur status/check ajouté; scripts ops avec SSH/gcloud encore à migrer opération par opération. |
| Recherche, crawl, extraction Dragon Ball | Aphrody Web | Le crawler générique et MediaWiki sont disponibles; `crawl-guides.ts`, `rag-recon.ts` et scrape/recon/search/crawl-worker de `rag-harvest.ts` utilisent les clients Aphrody Web. Les adaptateurs de source et règles Dragon Ball restent des contrats de domaine à déplacer/conserver côté Shenron. |
| Types, configuration, canon, API/site, bot et UI Shenron | Shenron | Domaine produit : reste dans Shenron. Les capacités partagées sont appelées via contrats Aphrody. |

## Points encore à migrer

- `bxc-asset-harvest.ts` et `bxc-ingest.ts` utilisent désormais Aphrody Web
  pour le scrape/reconnaissance. Le téléchargement miroir récursif d'assets
  dans `bxc-asset-harvest.ts` reste BXC : l'API Crawl Aphrody renvoie pages,
  contenu structuré et liens découverts, mais n'aspire pas les binaires liés
  dans une arborescence locale. `rag-harvest.ts` conserve aussi BXC pour ce
  besoin de miroir. Plusieurs scripts médias et tâches d'exploitation
  spécialisées restent à migrer après rapprochement de leurs contrats avec
  `aphrody web frames`, le navigateur et les clients Infra.
- Le flux `crawl universal` est redirigé vers le worker Aphrody Web, mais il
  doit être validé sur un petit lot réel avant de remplacer les anciennes
  sorties. Les crawls complets Fandom sont volontairement hors exécution de
  cette migration : leur configuration plafonne à 50 000 pages avec 6 s entre
  requêtes.
- L’adaptateur infra fournit status/check; déploiement, accès base et opérations
  spécifiques restent à porter dans Aphrody avant de supprimer leurs appels
  SSH/gcloud.
- Le dépôt BXC distant reste intact. Cette migration ne prétend pas transférer
  ni supprimer son historique, ses fonctions génériques non Shenron ou ses
  données protégées.

## Contrats Aphrody ajoutés dans cette tranche

- `aphrody web crawl` renvoie maintenant Markdown, texte, métadonnées et blocs
  extraits dans son JSON, et accepte des filtres d’URL regex répétés.
- Le crawl reste explicitement borné par profondeur, nombre de requêtes,
  concurrence, délai par hôte et domaine autorisé; son frontier SQLite permet
  de reprendre et coordonner les travaux sur un stockage partagé compatible.
- `aphrody web mediawiki` énumère un ensemble borné par l’Action API MediaWiki,
  applique un intervalle partagé aux requêtes et extrait le Markdown avec
  `aphrody-web-extract`.
- `aphrody translate --json --source <lang> --target <lang> -- <text>` expose
  une réponse `translatedText/detectedSource/target/provider` provenant de la
  crate Rust. Ce mode respecte les langues demandées, propage les échecs et
  refuse les réponses vides; il ne substitue pas le texte original après un
  échec de fournisseur. Le mode interactif conserve son comportement existant.
  Le consommateur requiert un binaire Aphrody incluant ce nouveau flag; le
  chemin du binaire est configurable avec `APHRODY_BIN`.
- Le worker `packages/shenron/pipeline/scripts/aphrody-web-corpus-crawl.ts`
  lit le plan de domaine Shenron, appelle ces contrats et écrit les exports
  dans l’espace DBFR Aphrody.
