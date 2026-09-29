import { existsSync } from "node:fs";
import { join } from "node:path";

import { GlobalFonts } from "@aphrody/canvas";

const FONTS_DIR = join(process.cwd(), "assets", "fonts");

const FONTS: ReadonlyArray<{ file: string; alias: string }> = [
	// Police de corps principale : Inter (Latin complet + accents FR), rendue parfaitement
	// par Skia (régulier ET gras via la variable). Indispensable : Skia/napi-rs ne résout
	// PAS le mot-clé générique `sans-serif` → tout texte en `sans-serif` sort en tofu (▯).
	{ file: "InterVariable.woff2", alias: "Achillea Sans" },
	{ file: "Satoshi-Black.woff2", alias: "Achillea Display Num" },
	// Repli large (CJK/kana/symboles) pour les pseudos non latins ; cité en 2e famille.
	{ file: "MSGothic.woff2", alias: "Achillea Body" },
	// Polices décoratives historiques (gardées pour compat, mais illisibles en rendu serveur).
	{ file: "Dirtyline-36DOT.woff2", alias: "Achillea Display" },
	{ file: "HUMANE.woff2", alias: "Achillea Title" },
	{ file: "HUMANE-Bold.woff2", alias: "Achillea Title Bold" },
	{ file: "NeueMetanaNext.woff2", alias: "Achillea Title Alt" },
	{ file: "LiberationMono.woff2", alias: "Achillea Mono" },
];

let registered = false;

export function registerAchilleaFonts(): void {
	if (registered) return;
	registered = true;

	for (const { file, alias } of FONTS) {
		const path = join(FONTS_DIR, file);
		if (!existsSync(path)) continue;
		GlobalFonts.registerFromPath(path, alias);
	}
}
