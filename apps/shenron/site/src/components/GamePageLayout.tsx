import type { ReactNode } from "react";
import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/PageHeader";

/**
 * Enveloppe commune des pages de jeu jouables (pfc / morpion / bingo).
 * Gère l'auth, le conteneur centré et l'en-tête (grammaire `PageHero`).
 */
export async function GamePageLayout({
	path,
	title,
	subtitle,
	maxWidth = "max-w-xl",
	children,
}: {
	path: string;
	title: string;
	subtitle: (username: string) => ReactNode;
	maxWidth?: string;
	children: ReactNode;
}) {
	const me = await requireUser(path);
	return (
		<div className={`container mx-auto px-4 py-12 ${maxWidth}`}>
			<PageHeader
				eyebrow="Arène de combat"
				title={title}
				size="md"
				className="mb-8"
				subtitle={subtitle(me.user?.username ?? "")}
			/>
			{children}
		</div>
	);
}
