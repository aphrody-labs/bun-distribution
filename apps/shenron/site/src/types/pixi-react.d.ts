// Augmentation JSX pour @pixi/react v8 + React 19.
//
// @pixi/react expose les éléments intrinsèques (pixiContainer, pixiGraphics,
// pixiParticleContainer…) via `PixiElements`, mais son `types/global.d.ts`
// n'est pas chargé automatiquement par notre compilation (React 19 a déplacé
// le namespace JSX dans `react`/`react/jsx-runtime`). On réapplique ici
// l'augmentation pour que `<pixiContainer>` & co soient typés (cf. KiCanvas).
import type { PixiElements } from "@pixi/react";

declare module "react" {
	namespace JSX {
		interface IntrinsicElements extends PixiElements {}
	}
}

declare module "react/jsx-runtime" {
	namespace JSX {
		interface IntrinsicElements extends PixiElements {}
	}
}
