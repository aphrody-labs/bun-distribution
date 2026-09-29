"use client";

import { authClient } from "@/lib/auth-client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { sanitizeInternalPath } from "@/lib/internal-path";

/**
 * Page Connexion — refondue de zéro pour résoudre la boucle infinie.
 *
 * Causes racines de la boucle (avant fix):
 *  1. turbo.json ne forwardait pas DISCORD_CLIENT_ID/SECRET au build → Better
 *     Auth démarrait sans provider Discord → /api/auth/sign-in/social retournait
 *     "Provider not configured" → errorCallbackURL non set → redirect /signin
 *     → user reclique → boucle.
 *  2. createAuthClient() sans baseURL → en SSR initial pointait vers le
 *     mauvais origin.
 *  3. signIn.social retourne {data, error} en v1.6+ et ne throw pas →
 *     le try/catch ne captait rien → setLoading restait true ad vitam.
 *
 * Fix:
 *  - turbo.json: env array exhaustif
 *  - auth-client: baseURL = window.location.origin
 *  - signin: errorCallbackURL distinct (/signin?error=...) pour casser la
 *    boucle, lecture de la response {data, error}, timeout failsafe.
 */

const ERROR_LABELS: Record<string, string> = {
	access_denied: "Tu as annulé la connexion Discord.",
	invalid_state: "Session OAuth expirée. Essaie à nouveau, sans rafraîchir entre les étapes.",
	oauth_failed: "Discord a refusé la connexion. Vérifie tes paramètres de confidentialité.",
	server_error: "Erreur côté serveur. Si ça persiste, signale-le sur Discord.",
	missing_config: "L'authentification Discord n'est pas configurée. Contacte un admin.",
};

export default function SignInPage() {
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [callbackURL, setCallbackURL] = useState("/profil/me");

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		// `startsWith("/")` ne suffisait pas : `//exemple.test` et `/\exemple.test`
		// commencent par « / » mais désignent un AUTRE domaine — la redirection
		// post-OAuth devenait un tremplin vers un site tiers. `sanitizeInternalPath`
		// résout le chemin contre une origine bidon et refuse tout ce qui en sort.
		const cb = sanitizeInternalPath(params.get("callbackURL"), 300);
		if (cb) setCallbackURL(cb);
		const err = params.get("error");
		if (err) setError(ERROR_LABELS[err] ?? `Erreur Discord (${err}).`);
	}, []);

	async function handleSignIn() {
		if (loading) return; // double-click guard
		setError(null);
		setLoading(true);

		// Failsafe : si pour une raison X le redirect ne se produit pas dans les
		// 8s, on relâche le bouton + on affiche un message. Évite l'état zombie.
		const failsafe = window.setTimeout(() => {
			setLoading(false);
			setError("Discord ne répond pas dans le temps imparti. Vérifie ta connexion et réessaie.");
		}, 8000);

		try {
			const result = await authClient.signIn.social({
				provider: "discord",
				callbackURL,
				errorCallbackURL: "/signin?error=oauth_failed",
			});

			if (result?.error) {
				window.clearTimeout(failsafe);
				setLoading(false);
				const code = result.error.code ?? "server_error";
				setError(ERROR_LABELS[code] ?? result.error.message ?? "Connexion impossible. Réessaie.");
				return;
			}

			// Better Auth peut répondre en JSON (notamment derrière un proxy qui
			// absorbe le 302). Dans ce cas le redirect plugin n'est pas toujours
			// exécuté par le router Next : naviguer explicitement garantit le départ
			// vers Discord et évite le bouton bloqué jusqu'au failsafe.
			const oauthURL = result?.data?.url;
			if (result?.data?.redirect && typeof oauthURL === "string") {
				const parsed = new URL(oauthURL);
				if (parsed.origin !== "https://discord.com") {
					throw new Error("URL de connexion Discord inattendue.");
				}
				window.clearTimeout(failsafe);
				window.location.assign(parsed.toString());
				return;
			}

			window.clearTimeout(failsafe);
			setLoading(false);
			setError("Discord n’a pas fourni d’URL de connexion. Réessaie.");
		} catch (e) {
			window.clearTimeout(failsafe);
			setLoading(false);
			setError(
				e instanceof Error ? e.message : "Connexion impossible. Vérifie ta connexion réseau."
			);
		}
	}

	return (
		<section className="relative min-h-[80vh] flex items-center justify-center px-6 py-16">
			<div className="absolute inset-0 -z-10 pointer-events-none">
				<div
					className="absolute inset-0 opacity-40"
					style={{
						background:
							"radial-gradient(ellipse 60% 60% at 50% 40%, color-mix(in srgb, var(--color-dbz-ember) 22%, transparent), transparent 65%), radial-gradient(ellipse 50% 50% at 80% 70%, rgba(255,178,0,0.16), transparent 70%)",
					}}
				/>
			</div>

			<div className="relative w-full max-w-md rounded-2xl bg-white/[0.04] border border-white/[0.08] p-8 md:p-10">
				<header className="mb-8 text-center">
					<p className="font-display font-semibold text-[12px] tracking-[0.18em] uppercase text-dbz-orange mb-3">
						Connexion
					</p>
					<h1 className="font-display font-bold text-[32px] md:text-[40px] leading-[1.05] tracking-[-0.01em] text-white mb-3">
						Rejoins DBFR
					</h1>
					<p className="text-[15px] text-white/65 leading-relaxed">
						Lie ton compte Discord pour suivre ta progression, commenter les actualités et accéder à
						ton profil de guerrier.
					</p>
				</header>

				<button
					type="button"
					onClick={handleSignIn}
					disabled={loading}
					className="inline-flex w-full items-center justify-center gap-3 h-12 px-6 rounded-full bg-dbz-orange hover:bg-white disabled:bg-dbz-orange/60 disabled:cursor-wait text-black font-display font-bold text-[14px] tracking-[0.10em] uppercase transition-colors"
					aria-busy={loading}
				>
					{loading ? (
						<>
							<span
								className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"
								aria-hidden
							/>
							Redirection…
						</>
					) : (
						"Continuer avec Discord"
					)}
				</button>

				{error && (
					<div
						role="alert"
						className="mt-5 text-[13px] text-red-300 bg-red-500/10 border border-red-500/40 rounded-xl px-4 py-3 leading-relaxed"
					>
						{error}
					</div>
				)}

				<div className="mt-8 pt-6 border-t border-white/[0.08] text-[12px] text-white/50 leading-relaxed text-center">
					Aucun mot de passe stocké. L'authentification passe par Discord OAuth. En te connectant tu
					acceptes nos{" "}
					<Link
						href="/licence"
						className="underline decoration-white/30 hover:text-white hover:decoration-dbz-orange"
					>
						conditions
					</Link>
					.
				</div>

				<Link
					href="/"
					className="block mt-6 text-center text-[12px] text-white/55 hover:text-dbz-orange transition-colors"
				>
					← Retour à l'accueil
				</Link>
			</div>
		</section>
	);
}
