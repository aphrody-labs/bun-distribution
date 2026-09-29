import type { Metadata } from "next";
import { AdminAccessForm } from "./AdminAccessForm";

// Hors du segment /admin (donc hors du garde requireAdmin) : c'est précisément
// la porte d'entrée quand on n'a pas (ou plus) de session Discord.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Accès admin",
	robots: { index: false, follow: false },
};

export default function AdminAccessPage() {
	return (
		<div className="container mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
			<div>
				<h1 className="text-2xl font-bold text-white">Accès administrateur</h1>
				<p className="mt-2 text-sm text-white/55">
					Connexion par token, sans passer par Discord. Saisis le token admin du bot (
					<code className="text-white/70">SHENRON_ADMIN_TOKEN</code>) pour ouvrir une session admin
					sur ce navigateur.
				</p>
			</div>
			<AdminAccessForm />
		</div>
	);
}
