# yolo et le fork Bun : un seul produit runtime

Directive propriétaire du 2026-10-06 : le CLI `yolo` et le fork Bun (`aphrody-labs/bun`) forment un seul produit
runtime. Le binaire fusionné s'appelle **`yolo`** ; **`bun`** reste un alias compatible (lien, même fichier,
`argv0` `bun`). Les identités publiques existantes (noms de commande, paquets `@aphrody/*`, schémas) ne changent pas.

Rattachement : [PLAN.md §6](../../../PLAN.md), [BUN-FORK-UNIFIED-NATIVE](../../migration/BUN-FORK-UNIFIED-NATIVE.md).

## Cible

- Un fichier exécutable produit par `bun-forge` : `yolo`. Lancé comme `yolo`, il expose les commandes `yolo`
  (CLI, `forge`, `ops`, `workspace`, `update`…) en natif ; lancé comme `bun` (lien `bun -> yolo`), il se comporte
  comme Bun. Aucune copie du moteur : pas de second binaire Bun, pas de `bun build --compile` du CLI par-dessus
  une copie du runtime.
- `yolo` (ancien exécutable compilé, `~/.local/bin/yolo`) devient un alias de compatibilité du binaire fusionné
  jusqu'à sa disparition ; `bun-fork` (lien d'activation provisoire) disparaît au profit de `yolo`/`bun`.

## État mesuré (2026-10-06)

- [x] Nom du binaire et alias dans `bun-forge` : l'artefact est `yolo`, `bun` est un lien symbolique relatif vers
  `yolo` (`BINARY`, `artifactLayout` dans `apps/yolo/forge/src/plan.ts`). L'étape `smoke` exécute le script de
  fumée par les deux noms et refuse le reçu si `argv0` ou la révision diffèrent ; le reçu porte `alias` et
  `smokeAlias`. Tests : `apps/yolo/forge/test/forge.test.ts` (26 verts), dont un test d'`argv0` réel
  (`yolo` et `bun` liés au même exécutable, `process.argv0` vérifié).
- [ ] Commandes `yolo` natives dans le fork : ouvert. Il faut un correctif dans `aphrody-labs/bun`
  (détection `argv0` `yolo` au démarrage, CLI `apps/yolo/cli` embarqué dans `src/js` comme module du runtime,
  repli sur le comportement Bun pour tout autre nom). Qualification : build `bun-forge` sur la fabrique, puis
  tests de parité (même sortie pour `yolo <cmd>` du fork et de l'exécutable compilé actuel).
- [ ] Packaging : `downloads` (installeurs `apps/yolo/install.sh`, `install.ps1`) installent `yolo` et créent le
  lien `bun` ; bascule après la qualification du point précédent (activation = installation locale, hors lot).
- [ ] Épinglage : `config/vendor.json` avance avec le correctif ; `packageManager` (`bun@1.4.2` dans 20
  manifestes) suit l'alias une fois `bun` = fork.

## Hors périmètre

Aucune publication publique. Les paquets npm, noms de commandes et schémas gardent leurs identités.

## Décision définitive du 2026-10-06 : runtime unique `yolo`, qui charge `vu`

Tranché par l'agent exécutant sur ordre du propriétaire (« runtime unique yolo, charge vu et notre fork bun »).

| Question | Décision | Raison |
| --- | --- | --- |
| Produit | Un seul runtime : **`yolo`** = fork Bun (`aphrody-labs/bun`) + CLI `yolo`. | Les runtimes sont les produits ([positionnement](../../../AGENTS.md)) ; un seul artefact à livrer, vérifier et installer. |
| Noms | `yolo` (principal), `bun` (alias moteur, `argv0`), `vu` (alias Python, `argv0`). Pas de codename `nub` : un quatrième nom, quasi homonyme de `bun`, sans consommateur ni gain. | Un nom par rôle ; le nom `vu` est réglé une fois dans `vu/scaffold/vu.json` (plan vu §0, §4.5). |
| `vu` dans `yolo` | `yolo` **charge** `vu` : `yolo py …` et `vu …` délèguent à l'artefact `vu` installé (`~/.vu/current`, manifeste vérifié). `vu` n'est **pas** lié statiquement dans le binaire Bun. | `vu` a son dépôt, son cycle de build (uv release : 20 min, 6 Gio de pic ; ruff plus lourd) et sa matrice glibc ; fusionner les liens casserait le plafond glibc 2.39 du fork et la qualification par fabrique. |
| Lien natif | **Une seule libpython partagée** (celle de l'artefact `vu`) : `yolo` (`bun:ffi`) et `libaphrody` (PyO3) l'ouvrent en global (`RTLD_GLOBAL`) ; aucun second CPython. | Liaison Bun ↔ Python ↔ Rust sans copie ni double interpréteur. |
| Dépendance | Sens unique : `yolo` → artefact `vu` (contrat : manifeste schéma 1, `compatibility.cliMajor`) ; `vu` ne dépend jamais de `yolo`. Aphrody → `yolo`/`vu` par artefact. | Plan vu D3, D12. |
| Hors périmètre | Aucune publication publique ; `config/vendor.json` ne bouge qu'après qualification `yolo forge build`. | Règles du fork. |

Ordre d'exécution : (1) commandes `yolo` natives dans le fork (détection `argv0`), (2) chargement de l'artefact `vu` par `yolo py|vu`, (3) libpython partagée en global côté fork et `libaphrody`, (4) packaging `install.sh`/`install.ps1` : `yolo` + liens `bun` et `vu`.
