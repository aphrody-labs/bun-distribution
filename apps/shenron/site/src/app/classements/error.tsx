"use client";

import { SectionError } from "@/components/SectionError";

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
	return (
		<SectionError
			{...props}
			title="Les classements n'ont pas pu s'afficher"
			backHref="/"
			backLabel="Accueil"
		/>
	);
}
