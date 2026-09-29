"use client";

import { SectionError } from "@/components/SectionError";

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
	return (
		<SectionError
			{...props}
			title="Les films n'ont pas pu s'afficher"
			backHref="/wiki/films"
			backLabel="Retour aux films"
		/>
	);
}
