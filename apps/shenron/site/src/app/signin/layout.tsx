/**
 * `signin/page.tsx` est un composant client : il ne peut pas exporter de
 * `metadata`. Cette coque n'existe que pour porter les métadonnées — sans elle,
 * la page de connexion héritait du titre générique du site.
 */
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Connexion",
	description: "Connecte-toi avec Discord pour retrouver ton profil, tes favoris et tes tierlists.",
	// Page transactionnelle : aucune valeur en résultat de recherche.
	robots: { index: false, follow: true },
};

export default function SigninLayout({ children }: { children: React.ReactNode }) {
	return children;
}
