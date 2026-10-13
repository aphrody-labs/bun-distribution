<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody

Un seul produit Aphrody possède les parcours d’installation, d’administration,
de création et les entrées web. Le propriétaire est `@aphrody/product` ; les
capacités runtime viennent du fork Bun et l’UI partagée de Material
(`@aphrody/app-ui`). L’application native reste dans `crates/ui/app` ; ses routes
administrateur et créateur utilisent le protocole `aphrody.kit/1`.
L’unification des publications et domaines est encore en cours.

`web cloudflare deploy` prépare les assets publics Aphrody et Bun avec les builders
du checkout Bun sélectionné, puis utilise le Worker existant. `--dry-run` prépare
et valide le paquet sans le publier. `--assets DIR` utilise un artifact déjà préparé.

```sh
bun packages/infra/product/src/cli.ts setup --oui --roles admin,createur --simuler
bun packages/infra/product/src/cli.ts admin verifier
bun packages/infra/product/src/cli.ts creator --help
bun packages/infra/product/src/cli.ts web start --root /path/to/ui-dist --port 3000
bun packages/infra/product/src/cli.ts web os
bun packages/infra/product/src/cli.ts web cloudflare --help
bun packages/infra/product/src/cli.ts web cloudflare deploy --dry-run
```

Les API sont réutilisables sans démarrer de CLI à l’import :

```ts
import { buildAccessPack, install, stepsFor } from "@aphrody/product";
import { validateRequest } from "@aphrody/product/train";
import { parseAccessPack } from "@aphrody/product/access";
import { startWeb } from "@aphrody/product/web";
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
