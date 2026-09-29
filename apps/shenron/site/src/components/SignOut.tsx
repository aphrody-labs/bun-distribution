"use client";

import { authClient } from "@/lib/auth-client";
import { useState } from "react";

/**
 * Bouton de déconnexion Better Auth. Clear la session puis redirige vers
 * l'accueil (hard reload pour vider les server components getCurrentUser()).
 */
export function SignOut({
	className,
	children,
	"aria-label": ariaLabel,
}: {
	className?: string;
	children: React.ReactNode;
	"aria-label"?: string;
}) {
	const [loading, setLoading] = useState(false);
	return (
		<button
			type="button"
			disabled={loading}
			aria-busy={loading}
			aria-label={ariaLabel}
			onClick={async () => {
				if (loading) return;
				setLoading(true);
				try {
					await authClient.signOut();
				} finally {
					// eslint-disable-next-line @next/next/no-location-assign-relative-destination
					window.location.href = "/";
				}
			}}
			className={className}
		>
			{children}
		</button>
	);
}
