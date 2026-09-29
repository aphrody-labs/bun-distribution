# Pipeline Aphrody unifiée

`aphrody-infra` est la façade unique des gates de production pour les dépôts
catégorie Aphrody (`aphrody-ai`, `aphrody-os`, `aphrody-ui`, `aphrody-web`,
`aphrody-compat`, `aphrody-contracts`, `aphrody-shell`, `aphrody-native`),
`aphrody-infra` lui-même, RG, Shenron, NIE et IECode. Les dépôts gardent leur
code et leurs scripts, mais le graphe d’exécution est déclaré une seule fois
dans `config/pipeline.json`.

## Runners

Chaque étape s’exécute dans `<workspaceRoot>/<repo>` :

- `bun` (défaut) : `bun <command>`, donc un script de `package.json` ;
- `just` : `just <command>`, une recette du `Justfile`. Les dépôts Rust purs
  (`aphrody-contracts`, `aphrody-shell`, `aphrody-native`) n’ont pas de
  `package.json` ; les dépôts Bun + Rust exposent leurs gates Cargo
  (`check`, `clippy`, `test`, `fmt-check`) par la même voie.

`aphrody-infra validate` refuse une étape dont le dépôt n’est pas un dépôt
vivant de `config/stack-training.json` (un dépôt retiré comme le monolithe
`aphrody` est rejeté).

## Commandes

```bash
bun run pipeline                 # afficher le graphe
aphrody-infra pipeline --stage check    # dry run : dépôt, manifeste et script/recette de chaque étape
bun run pipeline:stage format    # format/check docs
bun run pipeline:stage lint      # lint polyglotte (oxlint, clippy)
bun run pipeline:stage types     # type-check Rust/Bun/TS
bun run pipeline:stage unit-and-ui
bun run pipeline:stage build
bun run pipeline:stage release
bun run pipeline:stage all
```

Les stages parallèles sont isolés par dépôt ; le build et la release restent
ordonnés. Le build suit le graphe des dépendances Bun : `aphrody-compat`, puis
`aphrody-ui` (paquets M3 et `@aphrody/bun` sur la crate `aphrody-bun`),
`aphrody-web`, `aphrody-ai` et `aphrody-os`. Le Next 16 canary est consommé par
les applications qui le déclarent dans leur catalogue Bun, avec une seule
compilation du site par release.

Le stage `release` exécute `verify:release` d'`aphrody-ai` puis
`release:bundle` d'`aphrody-infra`, c'est-à-dire
`scripts/build-aphrody-stack-release.sh` : depuis un clone propre du
superprojet `aphrody-src` sur ext4 dans WSL Ubuntu-24.04 (préparé par
`scripts/prepare-release-workspace.sh`, sous-modules à leur gitlink), il
construit le bundle unique de la VPS — la release Aphrody (cinq services, smoke
local attesté par `SMOKE.json`), l'artefact Shenron (`bun run site:artifact` et
`git archive`) et l'épinglage du commit RG — et enregistre les 13 SHA des
sous-modules dans `BUNDLE.json` et `RELEASE_SHA`
([`IMMUTABLE-RELEASES.md`](../../operations/infra/IMMUTABLE-RELEASES.md)). La release RG reste
assemblée sur la VPS par `scripts/rg/assemble-vps-release.sh`. NIE et IECode ne
publient plus de release VPS. Les adaptateurs sont testés sous Linux/WSL en
root par `bun run test:adapters` (`test-atomic-deploy-{rg,shenron,bundle}.sh`,
systemd/Nginx/curl remplacés par des stubs).

## Production

Le pipeline ne déploie que si tous les stages sont verts. L’adaptateur final
reste le CLI Rust `aphrody-infra deploy --target vps --stack bundle --release
/srv/aphrody-infra/bundles/ID --apply`, qui active Aphrody, puis Shenron, puis
RG, chacun par son adaptateur atomique (Nginx validé, sondes loopback et HTTPS,
rollback), enregistre `BUNDLE.previous.json` et restaure les étapes déjà
activées si une étape échoue. `--stack aphrody|shenron|rg` active une seule
pile. Les crawlers, mirrors et jobs lourds ne font pas partie du chemin
critique.

## Connaissance monorepo

```bash
bun run knowledge:scan
```

Le scan est asynchrone et produit un manifeste borné dans `var/runs/`. Il
cartographie les dépôts listés dans `config/knowledge-scope.json` : packages,
scripts, crates, workflows, tests, docs, extensions et capabilities. Les arbres
générés, assets lourds, bases, secrets et dépendances installées sont exclus. Le
résultat est directement consommable par YOLO/RAG et chaque run garde ses
preuves.
