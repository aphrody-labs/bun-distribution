# RG imports, exports et documentation

Audit de l'intégration partielle de RG dans le workspace Aphrody au
2026-09-29. Les manifests restent propriétaires de `packages/rg/**`; ce
document consigne les points à corriger par leurs propriétaires sans modifier
leurs API.

## État vérifié

## Pipeline RG

La pipeline RG découvre les manifests récursivement, puis filtre les résultats
aux seuls membres effectifs des globs `workspaces` racine. Son rapport liste les
membres sélectionnés, les étapes exécutées et le ratio de couverture entre
contrôles configurés et packages retenus.

- Les imports statiques `@rosegriffon/*` détectés dans `apps/rg/**` et
  `packages/rg/**` correspondent à un export exact ou à un motif `*` de leur
  manifest. L'audit couvre les imports `from` et `import()` dans les sources
  TypeScript.
- Les sous-chemins consommés incluent notamment `@rosegriffon/db/*`,
  `@rosegriffon/azalee/*`, `@rosegriffon/achillea-core/*`,
  `@rosegriffon/auth/*`, `@rosegriffon/types/*`, `@rosegriffon/ui/*` et
  `@rosegriffon/inagle`.
- Les racines `@rosegriffon/inagle` et `@rosegriffon/patreon-bun` ciblent
  `dist/`, qui n'est pas présent dans un checkout propre avant leur build.
  Les consommateurs doivent donc ordonner ces builds avant les imports, ou les
  manifests doivent exposer une condition source compatible avec les
  workspaces. Les vérifications de ce lot n'ont pas généré ces répertoires.
- Le README Azalée prétendait exposer `@rosegriffon/azalee/data/*`, absent du
  champ `exports`; cette ligne a été retirée. Le README décrit maintenant les
  chemins actuels `apps/rg/website` et `packages/rg/azalee` (not in repo).
- Les documents RG importés pointent maintenant vers le plan racine, les
  chemins `apps/rg`, `packages/rg`, `scripts/rg`, et les notes sous `docs/<catégorie>/rg` (anciennement `docs/rg` (not in repo), rangé par catégorie le 2026-10-02).
  Le guide d'index n'invente plus de lien local vers le checkout frère Infra.

## Compatibilité à résoudre

1. Qualifier la résolution des exports `dist` d'Inagle et Patreon-Bun sur un
   clone propre, puis choisir entre build préalable explicite et exports source
   pour les consommateurs workspace. Garder leurs chemins de publication
   compatibles avec les artefacts distribués.
2. Les imports historiques `@aphrody-code/bxc`, `@aphrody/bxc` et le paquet
   inexistant `@aphrody/zukan` ont été retirés du code actif. Les consommateurs
   browser utilisent `WebCdpPage` de `@aphrody/agent-browser/cdp`; ce contrat
   exige un serveur CDP Aphrody Web déjà lancé. Il expose la navigation,
   l'évaluation DOM, le HTML et la fermeture, mais pas le `Browser/Page` de BXC,
   la conversion Markdown du moteur Rust, ni ses fonctions DNS/Wappalyzer/HAR.
   `scrape.page` rend donc le texte visible du DOM; `web-recon` produit un HAR
   synthétique à partir des sondes HTTP et marque la détection de frameworks
   comme indisponible. Google est remplacé par le fallback DuckDuckGo HTML.
   Vérifier ces limites lors de l'intégration runtime et garder l'option de
   brancher plus tard une API Aphrody Web publique équivalente.

3. Les manifests et alias catalogues doivent être nettoyés par leur owner;
   après leur alignement, exécuter de nouveau
   `@aphrody/workspace` import-export audit et les typechecks/builds ciblés; un
   contrôle d'exports statique ne prouve pas la résolution Bun/TypeScript 7 au
   runtime.

## Contrôles effectués

- Scanner statique des exports déclarés et des imports `@rosegriffon/*` dans
  les sources actives RG: aucun sous-chemin absent.
- `bun packages/infra/aphrody-workspace/src/ops.ts docs-links --root
  . --docs docs/rg --scope docs` (historique; `docs/rg` (not in repo) est désormais réparti sous `docs/<catégorie>/rg`): 90 liens locaux vérifiés,
  zéro lien cassé.
- Les tests browser ont été portés vers Aphrody Web CDP; les tests navigateur
  sont sautés explicitement si le serveur local est absent. Un test du helper
  `waitForSelector` couvre le contrat sans serveur. Ils restent à exécuter après
  l’alignement du lock et des manifests.
