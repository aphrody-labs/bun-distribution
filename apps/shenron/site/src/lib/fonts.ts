import { Newsreader } from "next/font/google";

/**
 * Typographie du **journal éditorial** (`/actualites`).
 *
 * Le reste du site tourne sur Google Sans Flex (grotesque, tokens `--font-sans`
 * / `--font-display`), qui porte l'identité Dragon Ball. Les pages d'articles
 * assument une direction différente — presse écrite plutôt que jeu vidéo — d'où
 * une serif dédiée exposée en `--font-editorial`.
 *
 * Newsreader : serif de lecture open-source (variable, axe opsz 6→72), dessinée
 * pour le texte long à l'écran. Contreformes ouvertes et hauteur d'x généreuse
 * ⇒ tient la lecture sur plusieurs milliers de signes, ce qu'une display serif
 * ne fait pas.
 *
 * Déclarée ici et NON dans `app/layout.tsx` à dessein : next/font ne précharge
 * la police que sur les routes qui appliquent réellement la classe. La poser sur
 * le `<html>` racine la ferait précharger sur les ~850 pages du site pour n'être
 * utilisée que sur le journal — coût LCP inutile partout ailleurs.
 */
export const editorialSerif = Newsreader({
	variable: "--font-editorial",
	subsets: ["latin", "latin-ext"],
	display: "swap",
	// Axe optique : Next génère la variable font, le CSS pilote `font-optical-sizing`.
	axes: ["opsz"],
	style: ["normal", "italic"],
	fallback: ["Iowan Old Style", "Charter", "Georgia", "serif"],
});
