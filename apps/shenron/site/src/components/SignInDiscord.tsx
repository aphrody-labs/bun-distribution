"use client";

import { authClient } from "@/lib/auth-client";
import { useState } from "react";

export function SignInDiscord({
	callbackURL,
	className,
	children,
}: {
	callbackURL?: string;
	className?: string;
	children: React.ReactNode;
}) {
	const [loading, setLoading] = useState(false);
	return (
		<button
			type="button"
			disabled={loading}
			aria-busy={loading}
			onClick={async () => {
				if (loading) return;
				setLoading(true);
				const failsafe = window.setTimeout(() => setLoading(false), 8000);
				try {
					// signIn.social retourne {data, error} en v1.6+ et ne throw pas.
					// errorCallbackURL casse la boucle si Discord refuse ; on bascule
					// vers /signin (message lisible) en cas d'erreur silencieuse.
					const res = await authClient.signIn.social({
						provider: "discord",
						callbackURL: callbackURL ?? "/profil/me",
						errorCallbackURL: "/signin?error=oauth_failed",
					});
					if (res?.error) {
						window.clearTimeout(failsafe);
						setLoading(false);
						// eslint-disable-next-line @next/next/no-location-assign-relative-destination
						window.location.href = `/signin?error=${res.error.code ?? "server_error"}`;
						return;
					}
					// Better Auth répond en JSON avec {url, redirect: true}. On navigue
					// explicitement vers Discord pour déclencher l'écran OAuth.
					const oauthURL = res?.data?.url;
					if (res?.data?.redirect && typeof oauthURL === "string") {
						const parsed = new URL(oauthURL);
						if (parsed.origin === "https://discord.com") {
							window.clearTimeout(failsafe);
							window.location.assign(parsed.toString());
							return;
						}
					}
					window.clearTimeout(failsafe);
					setLoading(false);
					// eslint-disable-next-line @next/next/no-location-assign-relative-destination
					window.location.href = "/signin";
				} catch {
					window.clearTimeout(failsafe);
					setLoading(false);
					// eslint-disable-next-line @next/next/no-location-assign-relative-destination
					window.location.href = "/signin?error=server_error";
				}
			}}
			className={className}
		>
			{children}
		</button>
	);
}
