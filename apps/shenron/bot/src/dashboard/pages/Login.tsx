import { type FormEvent, useState } from "react";
import { api } from "../lib/api";

function DiscordIcon() {
	return (
		<svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
			<path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
		</svg>
	);
}

interface Props {
	onLogin: () => void;
}

export function Login({ onLogin }: Props) {
	const [token, setToken] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		setLoading(true);
		try {
			await api.post("/auth/login", { token });
			onLogin();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Login failed");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-950 via-zinc-900 to-amber-950/40 p-4">
			<form onSubmit={submit} className="card w-full max-w-md space-y-6">
				<div className="text-center">
					<img
						src="/assets/logo.webp"
						alt="Shenron"
						className="mx-auto mb-3 h-20 w-20 rounded-2xl object-cover"
					/>
					<h1 className="text-2xl font-bold text-brand-400">Tableau de bord Shenron</h1>
					<p className="mt-1 text-sm text-zinc-400">
						Authentification requise pour accéder à l'administration du bot.
					</p>
				</div>

				<div>
					<label htmlFor="token" className="mb-2 block text-sm font-medium text-zinc-300">
						Jeton administrateur
					</label>
					<input
						id="token"
						type="password"
						className="input"
						value={token}
						onChange={(e) => setToken(e.target.value)}
						placeholder="API_ADMIN_TOKEN"
						required
						autoFocus
					/>
					<p className="mt-1 text-xs text-zinc-500">
						Jeton défini dans le fichier <code>.env</code> du bot, variable{" "}
						<code>API_ADMIN_TOKEN</code>.
					</p>
				</div>

				{error && (
					<div className="rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-400">
						{error}
					</div>
				)}

				<button type="submit" disabled={loading || !token} className="btn btn-primary w-full">
					{loading ? "Vérification…" : "Connexion par jeton"}
				</button>

				<div className="relative my-2">
					<div className="absolute inset-0 flex items-center">
						<div className="w-full border-t border-zinc-800" />
					</div>
					<div className="relative flex justify-center">
						<span className="bg-zinc-900/40 px-3 text-xs uppercase tracking-wide text-zinc-500">
							ou
						</span>
					</div>
				</div>

				<button
					type="button"
					onClick={async () => {
						// Better Auth POST /api/auth/sign-in/social → renvoie { url } puis redirect
						const res = await fetch("/api/auth/sign-in/social", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ provider: "discord", callbackURL: "/" }),
						});
						if (!res.ok) {
							setError(`Better Auth: ${await res.text().catch(() => res.statusText)}`);
							return;
						}
						const { url } = (await res.json()) as { url?: string };
						if (url) window.location.href = url;
						else setError("Better Auth: pas d'URL renvoyée");
					}}
					className="btn w-full bg-[#5865F2] text-white hover:bg-[#4752c4]"
				>
					<DiscordIcon />
					Continuer avec Discord
				</button>

				<a href="/auth/discord" className="text-center text-xs text-zinc-500 hover:text-zinc-300">
					(méthode alternative — flow OAuth manuel legacy)
				</a>

				<p className="text-center text-xs text-zinc-500">
					Seuls les utilisateurs whitelistés peuvent se connecter via Discord.
				</p>
			</form>
		</div>
	);
}
