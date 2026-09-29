"use client";

import { SectionError } from "@/components/SectionError";

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
	return (
		<SectionError
			{...props}
			title="Les épisodes n'ont pas pu s'afficher"
			backHref="/wiki/episodes"
			backLabel="Retour aux épisodes"
		/>
	);
}
