"use client";

import { SectionError } from "@/components/SectionError";

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
	return (
		<SectionError
			{...props}
			title="La boutique n'a pas pu s'afficher"
			backHref="/"
			backLabel="Accueil"
		/>
	);
}
