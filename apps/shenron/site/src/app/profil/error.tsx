"use client";

import { SectionError } from "@/components/SectionError";

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
	return (
		<SectionError
			{...props}
			title="Le profil n'a pas pu s'afficher"
			backHref="/leaderboard"
			backLabel="Le classement"
		/>
	);
}
