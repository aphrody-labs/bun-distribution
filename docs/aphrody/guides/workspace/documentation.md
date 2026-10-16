<!-- SPDX-License-Identifier: Apache-2.0 -->
# Gérer la documentation Aphrody

Propriétaire : `@aphrody/workspace`.
Configuration : [documentation.json](../../../../tools/aphrody/config/docs/documentation.json).
Navigation : [Workspace](README.md) ; [runtime](../../architecture/runtime-native/README.md).

## Commandes

```sh
bun run docs -- status
bun run docs:gen
bun run docs:check
bun run docs:audit
bun run docs:check-links
bun run docs:overlaps -- --include workspace
bun run docs:site
```

`gen` régénère références, inventaire et index ; `check` compare sans écrire.
`audit` inventorie sans supprimer. `check-links` conserve le contrôle complet,
y compris ses échecs préexistants. Les sorties générées se corrigent à la source.

## Une source par contenu

Guides : `docs/guides/<domaine>` ; contrats : `docs/apis` ; architecture :
`docs/architecture` ; exploitation : `docs/operations`. Le README propriétaire
garde les commandes locales et renvoie vers ces pages.

Consolidation : `docs-consolidate scan → plan → apply → verify`.
Comparer les copies avant retrait, conserver les faits uniques, réparer les liens,
enregistrer l'autorité dans la source map. Aucun clone, copie de travail ou
nouvelle archive. Les traductions, licences, templates et preuves datées gardent
leurs rôles distincts ; une similarité ne prouve pas un doublon.

JSON : respecter schémas, champs, ordre des listes et valeurs ; ne pas minifier
les configurations pour afficher une réduction. Retirer les copies documentaires
de config au profit de leur propriétaire. Pour une clé répétée, préserver la
valeur effectivement chargée et vérifier l'égalité sémantique avant/après.

Inventaire généré : [documentation.json](../../reference/workspace/documentation.json).
Index agents : [llms.txt](../../llms.txt). Ils référencent les mêmes pages.

## Références de code

Cibles déclarées → `docs/apis/generated/<id>.md`, chemins et hashes source.
TypeScript : exports/JSDoc AST, sans résoudre types inférés et réexports.
Python : AST sans import projet, Python ≥ 3.9. Rust : extraits `//!`/`///`,
pas API compilée complète. Sources Python/IECODE déclarées en lecture seule.
Pour les API complètes : [recherche](../../research/workspace/documentation-practices.md).

## Rédaction assistée

```sh
bun run docs -- ai translate docs/guides/workspace/documentation.md en
bun run docs -- ai translate docs/guides/workspace/documentation.md en --apply --online
```

Preview puis exécution autorisée via `@aphrody/doc-ai`. Le mode online envoie
la page déclarée au fournisseur configuré ; les références déterministes ne
dépendent pas d'un modèle. Vérifier contenu et navigation avant livraison.
Les entrypoints `docs:translate` et `docs:ai` restent compatibles.

## Export privé

`docs:site` exporte uniquement `site.include` vers `.cache/documentation-site` (not in repo) (generated or machine-local artifact; presence depends on the build host) :
HTML, Markdown canonique, index agents et manifeste vérifié. Refuser chemins
dangereux, symlinks et contenu étranger. HTML/MDX sources restent du texte ;
aucune exécution ni publication. Le serveur privé doit imposer l'authentification.

## Livraison autonome

Posséder les pages et sorties générées avant écriture ; préserver les changements
concurrents. Modifier → vérifier les liens/contenus → `git diff --check` →
`docs:check` → commit/push autorisés. Corriger les échecs possédés, signaler les
autres. Pas de confirmation intermédiaire ni de compilation moteur pour la prose.

Runtime : référencer [PLAN.md](../../PLAN.md) et les mémoires, sans recopier
états et hashes. Preuves historiques inchangées ; vérifier leur intégrité.
