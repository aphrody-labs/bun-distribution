<!-- SPDX-License-Identifier: Apache-2.0 -->
# Gérer la documentation Aphrody

Le propriétaire unique est `@aphrody/workspace`. Sa commande `docs` orchestre
les moteurs existants, les références de code, l'inventaire, l'index agents et
l'export web. La politique vit dans
[documentation.json](../../../config/docs/documentation.json).

## Commandes

Depuis la racine Aphrody :

```sh
bun run docs -- status
bun run docs:gen
bun run docs:check
bun run docs:audit
bun run docs:check-links
bun run docs:overlaps -- --include workspace
bun run docs:site
```

`docs:gen` produit les références déclarées, puis délègue au générateur
existant les index, STATE, ecosystem et upstreams. `docs:check` compare les
sorties attendues sans les écrire. `docs:audit` inventorie les Markdown suivis
et non ignorés, leurs SHA-256, classes et autorités ; il ne supprime rien.
`docs:check-links` conserve le contrôle complet existant : un échec dans une
page ancienne reste un échec et n'est pas masqué par le nouveau contrôleur.

Les anciennes opérations `docs-gen`, `docs-links`, `docs-overlaps` et
`docs-consolidate` restent disponibles. La consolidation conserve ses phases
scan, plan, apply, verify et hubs ; elle exige un plan qualifié et respecte les
modifications concurrentes. Les traductions et copies proches ne se fusionnent
pas automatiquement.

## Une autorité par contenu

Écrire les guides sous `docs/guides/<domaine>`, les API sous `docs/apis`, les
explications sous `docs/architecture` et les runbooks sous `docs/operations`.
Le README d'un package conserve ses commandes locales et renvoie vers ces
pages. Les notices, copies de distribution des plugins et preuves de migration
gardent leur rôle propre. Un alias d'autorité dans l'inventaire ne constitue
pas une autorisation de retirer un fichier chargé au runtime.

L'inventaire complet est
[documentation.json](../../reference/workspace/documentation.json).
L'entrée courte pour les agents est [llms.txt](../../llms.txt). Les index sont
générés à partir des mêmes chemins ; aucune seconde copie éditable des guides
n'est entretenue pour les agents ou le site.

## Références depuis le code

Les cibles explicites de la configuration produisent
`docs/apis/generated/<id>.md`, avec chemins et SHA-256 des sources.

- TypeScript : AST du compilateur, exports explicites, déclarations et JSDoc.
  Les types inférés et réexports ne sont pas résolus.
- Python : AST de la bibliothèque standard, signatures et docstrings, sans
  importer les modules du projet. Python 3.9 ou ultérieur est requis.
- Rust : extraits des commentaires `//!` et `///` avec lignes. Ce sont des
  extraits documentaires, pas une description complète des API compilées.

Les arbres Python et IECODE peuvent être des entrées déclarées en lecture
seule. Aucun checkout supplémentaire n'est créé. Pour qualifier les API
complètes, utiliser les adaptateurs natifs recommandés dans la
[recherche documentaire](../../research/workspace/documentation-practices.md),
et le wrapper Cargo sérialisé pour rustdoc. Les fichiers générés ne se modifient
pas à la main ; corriger la source ou la configuration puis régénérer.

## Rédaction ou traduction assistée

```sh
bun run docs -- ai translate docs/guides/workspace/documentation.md en
bun run docs -- ai translate docs/guides/workspace/documentation.md en --apply --online
```

La première commande affiche un plan. La seconde appelle le propriétaire
`@aphrody/doc-ai` sur une page canonique explicitement déclarée ; le contenu
est alors envoyé au fournisseur configuré. Les références déterministes ne
dépendent pas d'un modèle. Une traduction doit être relue avant d'être ajoutée
à la navigation ; une sortie offline identique n'est pas une traduction validée.
Les scripts directs `docs:translate` et `docs:ai` sont conservés pour les
consommateurs existants ; leur moteur filtre désormais les documents exclus
et remonte les échecs.

## Export web privé

`docs:site` utilise seulement les pages autorisées par `site.include`. Il
produit `.cache/documentation-site/index.html`, les pages HTML, leurs Markdown
canoniques, `llms.txt`, `llms-full.txt` et un manifeste d'export. Les hashes sont
vérifiés avant écriture ; les chemins dangereux, symlinks et fichiers étrangers
à l'export sont refusés.

Le rendu est volontairement simple : titres, paragraphes, code et liens entre
pages exportées. Le HTML et le MDX sources sont affichés comme texte, sans
exécution. Les autres liens sont affichés comme références au checkout ; les
copies Markdown restent intactes. L'artefact se sert tel quel sur un serveur
statique privé, sans étape de build Node, framework ou JavaScript client.

L'export ne lance aucun serveur et ne publie rien. Le serveur doit imposer
l'authentification avant une exposition réseau : CSP, robots et noindex ne
sont pas un contrôle d'accès. Aucun document interne n'est copié dans les
assets publics d'un produit. Une future publication demande une décision de
visibilité et sa propre liste de pages autorisées.
