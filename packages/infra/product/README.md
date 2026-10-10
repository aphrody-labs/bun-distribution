<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody

Un seul produit Bun réunit l’installation, l’administration et les outils créateur.
`Aphrody-Setup.exe` contient les trois modules. L’interface canonique reste celle
d’Aphrody, dans `m3/packages/app-ui` et `crates/ui/app` ; ses routes administrateur
et créateur utilisent ce même exécutable avec le protocole `aphrody.kit/1`.

```sh
bun packages/infra/product/src/cli.ts setup --oui --roles admin,createur --simuler
bun packages/infra/product/src/cli.ts admin verifier
bun packages/infra/product/src/cli.ts creator --help
```

Les API sont réutilisables sans démarrer de CLI à l’import :

```ts
import { buildAccessPack, install, stepsFor } from "@aphrody/product";
import { validateRequest } from "@aphrody/product/train";
import { parseAccessPack } from "@aphrody/product/access";
```

Les noms historiques `aphrody-setup`, `aphrody-omar` et `creator-kit` sélectionnent
un module du même point d’entrée. Les mises à jour de tous les rôles prennent le
produit complet dans le catalogue de `downloads.aphrody.com`, avec contrôle SHA-256,
installation préparée et restauration en cas d’échec. Les fichiers d’accès, clés,
configurations personnelles et journaux restent dans leurs stores existants.

Un hôte d’entraînement doit être déclaré dans le fichier d’accès. Aucun serveur
n’est choisi implicitement. Si la clé publique WireGuard du poste diffère de celle
du pair autorisé, l’installateur conserve le tunnel existant et attend sa qualification.

La livraison Windows utilise la recette Workspace existante :

```sh
bun scripts/release/stage-setup.ts --smoke
```

Les notices, extensions, ressources et guides absorbés restent dans `resources/`
et `assets/`. Les recettes de livraison historiques restent des adaptateurs de
compatibilité ; elles compilent ce même produit.
