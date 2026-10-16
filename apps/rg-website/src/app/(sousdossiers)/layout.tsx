/**
 * Coque des pages « sous-dossiers ». Le fond reposait sur deux teintes grises
 * brutes qui ignoraient les quatre thèmes du design system : le token
 * `bg-background` suit désormais le thème actif.
 */
export default function SousDossiersLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-screen flex-col bg-background animate-fade-in">{children}</div>
	);
}
