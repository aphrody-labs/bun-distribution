# @aphrody/rg-ui

Producteur canonique des composants partagés de Rose Griffon, Achilléa et Azalée, dans le monorepo Aphrody. Les imports IECODE restent possibles via l'alias npm `@rosegriffon/ui: npm:@aphrody/rg-ui@1.0.4`.

Les primitives interactives utilisent `@base-ui/react: npm:@aphrody/base-ui@1.8.0-aphrody.1`. Les noms exportés et les contrats consommés par RG sont conservés : composition `asChild`, valeurs scalar/array des groupes, sélection, focus des popups, panneaux conservés et placement. Les composants métier, hooks et utilitaires purs du package original sont conservés. Le slider rend toutes les poignées des plages; les sliders verticaux inversés exigent une primitive correspondante du producteur Base UI.

`SOURCE.json` conserve la révision, le chemin, les tailles et SHA-256 des 111 fichiers source importés. Le sous-module historique IECODE n'est pas modifié. Le code métier reste sous le régime du propriétaire; les notices des moteurs et primitives externes sont conservées dans leurs packages.

```css
@import "tailwindcss";
@import "@rosegriffon/ui/styles.css";
```

`styles.css` importe une seule feuille de marques `src/brands.css`. Elle contient cinq schémas complets générés par le moteur Rust `aphrody-m3-tokens` : Rose Griffon clair/sombre (`#e91e63`), Achilléa sombre (`#6d00ce`), Azalée clair/sombre (`#f89c5a`). Les classes historiques Roy et Gaëlle restent disponibles. Les classes natives `theme-rg`/`theme-rg-dark`, `achillea`/`theme-achillea`, `azalee-light`/`theme-azalee-light` et `azalee-dark`/`theme-azalee-dark` exposent les 49 rôles couleur, les alias sémantiques et les déclarations Tailwind du même moteur.

La configuration des graines appartient à IECODE : `packages/rg/config/rg-m3.json`. Construire l'exemple natif `sheets` via le wrapper Cargo sérialisé Aphrody, puis exécuter depuis IECODE :

```sh
bun scripts/tools/rg-m3.ts --generator <native-sheets> --output <aphrody>/m3/packages/rg-ui/src/brands.css
bun scripts/tools/rg-m3.ts --generator <native-sheets> --output <aphrody>/m3/packages/rg-ui/src/brands.css --check
```

`bun run tokens` projette le CSS canonique dans `src/tokens.ts` pour les consommateurs Canvas/Discord. Cette projection ne recalcule pas les couleurs M3. `bun run typecheck`, `bun run lint` et `bun test` qualifient les types et les interactions clients/SSR. Le préchargement DOM est celui du producteur `@aphrody/m3-config`.
