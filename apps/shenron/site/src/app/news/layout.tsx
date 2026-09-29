import { editorialSerif } from "@/lib/fonts";

// La feuille de style éditoriale n'est chargée QUE sur les routes du journal.
// L'importer depuis `globals.css` la ferait payer aux ~850 autres pages du site
// pour rien.
import "@shenron/ui/editorial.css";

/**
 * Enveloppe du journal.
 *
 * Pose le contexte `.editorial` (papier, encre, serif) et la variable de police
 * `--font-editorial`. Aucune lecture de session/cookie ici : le layout reste
 * purement statique, donc les pages en dessous gardent leur cache CDN (cf. la
 * règle « jamais de session dans un layout » de CLAUDE.md).
 */
export default function ActualitesLayout({ children }: { children: React.ReactNode }) {
	return <div className={`${editorialSerif.variable} editorial min-h-screen`}>{children}</div>;
}
