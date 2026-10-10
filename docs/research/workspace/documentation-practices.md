<!-- SPDX-License-Identifier: Apache-2.0 -->
# Pratiques documentaires depuis le code et pour les agents

Recherche vérifiée le 2026-10-03. Décision locale : un contrôleur Workspace,
Markdown comme contenu canonique, provenance déterministe, références de code
séparées de la rédaction, export web privé issu des mêmes pages.

## Organisation

[Diátaxis](https://diataxis.fr/start-here/) distingue tutoriels, guides de
tâches, références et explications selon les besoins du lecteur. Appliquer ces
intentions aux catégories Aphrody existantes ; éviter de reconstruire une
arborescence parallèle pour chaque runtime ou outil.

Les références décrivent les contrats du code. Les guides expliquent des tâches
reproductibles et les explications motivent les décisions. Un inventaire de
symboles n'explique pas les invariants ou les erreurs ; ces parties nécessitent
des commentaires de source et une revue technique.

## Génération depuis les sources

| Langage | Outil natif pour référence complète | Mise en œuvre initiale Aphrody |
| --- | --- | --- |
| TypeScript | [TypeDoc avec plugin Markdown](https://typedoc-plugin-markdown.org/docs) | AST compilateur, exports explicites/JSDoc, sans résolution de types |
| Rust | [rustdoc](https://doc.rust-lang.org/rustdoc/how-to-write-documentation.html) | Extraits de commentaires avec lignes et hash ; rustdoc complet reste un gate distinct |
| Python | [Sphinx autodoc](https://www.sphinx-doc.org/en/master/usage/extensions/autodoc.html) | AST statique signatures/docstrings, sans imports du code applicatif |

Le plugin TypeDoc produit du Markdown utilisable par plusieurs générateurs de
sites. Rustdoc utilise les commentaires Markdown du code et permet de tester
les exemples ; ses builds doivent passer par `cargo-serial.sh` dans Aphrody.
Sphinx autodoc importe les modules documentés : exécuter cette variante dans
un environnement contrôlé, plutôt que charger automatiquement des services
lors d'un inventaire documentaire.

Ne pas fabriquer de signature, token CSS, résultat de test ou déploiement à
partir d'un modèle. Conserver source, version, portée et hash ; distinguer
référence syntaxique, API résolue, exemple testé et observation runtime.

## Markdown pour les agents

La proposition [llms.txt v2](https://llmstxt.org/) recommande un index court,
avec liens décrits vers les détails Markdown et découverte par relations
`alternate`/`describedby`. C'est une proposition d'interopérabilité, pas une
garantie de lecture par tous les agents ni une politique de confidentialité.

Les agents doivent pouvoir lire la même page que les humains sans extraire
menus et scripts. Préférer titres explicites, phrases courtes, blocs de code
avec langage, exemples vérifiés, liens relatifs résolvables et descriptions de
portée. Un fichier complet concaténé est optionnel ; l'index court doit rester
le point d'entrée normal. Les versions traduites conservent leur langue et
leur état de revue, elles ne sont pas des doublons supprimables.

[Cloudflare Markdown for Agents](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/)
illustre la négociation `Accept: text/markdown`. Pour un serveur Aphrody futur,
servir les Markdown canoniques directement évite une conversion HTML et ses
pertes ; si une négociation est ajoutée, envoyer `Vary: Accept` et conserver
les mêmes contrôles d'accès pour HTML et Markdown.

## Site web

[VitePress](https://vitepress.dev/guide/deploy) montre une architecture de site
statique généré depuis Markdown. Ce type de renderer peut être branché au
manifeste plus tard ; il n'est pas nécessaire pour l'export privé initial,
qui fonctionne avec les outils déjà installés et des pages HTML simples.
La navigation et les fichiers agents doivent être des vues du même inventaire,
pas de nouvelles sources éditables.

Séparer visibilité et format : un Markdown lisible par un agent peut rester
privé. Exiger une liste de publication explicite, préserver les notices, éviter
les liens vers des fichiers privés et authentifier le serveur. Les attributs
robots/noindex ne remplacent jamais cette authentification.

## Maintenance et qualité

- Régénération déterministe et gate de comparaison dans la CI.
- Contrôles des chemins, liens et ancres sur le périmètre annoncé.
- Doublons exacts par hash ; proximité lexicale comme aide de revue seulement.
- Protection des fichiers modifiés, provenance des déplacements et alias des
  autorités ; les copies distribuées de plugins restent qualifiées séparément.
- Rédaction/traduction IA explicite, erreurs propagées, revue du résultat.
- Aucun succès global annoncé à partir de gates ciblés ; les limites du corpus
  existant et des extracteurs restent consignées.
