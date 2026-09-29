"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminAccessForm() {
	const router = useRouter();
	const [token, setToken] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function autoConnect(candidateToken: string) {
		setError(null);
		setBusy(true);
		try {
			const res = await fetch("/api/admin-access", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token: candidateToken, durable: true }),
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				setError(data?.error ?? "Échec de la connexion automatique.");
				setBusy(false);
				return;
			}
			router.push("/admin/dashboard");
			router.refresh();
		} catch {
			setError("Réseau indisponible. Réessaie.");
			setBusy(false);
		}
	}

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		await autoConnect(token);
	}

	async function logout() {
		await fetch("/api/admin-access", { method: "DELETE" }).catch(() => {});
		router.refresh();
	}

	return (
		<form onSubmit={submit} className="flex flex-col gap-3">
			<input
				type="password"
				value={token}
				onChange={(e) => setToken(e.target.value)}
				autoComplete="off"
				aria-label="Token d'accès administrateur"
				placeholder="Token admin"
				className="rounded-lg border border-white/15 bg-black/40 px-3 py-2.5 text-sm text-white outline-none focus:border-dbz-orange"
			/>
			{error && <p className="text-[13px] font-semibold text-rose-400">{error}</p>}
			<button
				type="submit"
				disabled={busy || token.length < 8}
				className="rounded-lg bg-dbz-orange px-5 py-2.5 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
			>
				{busy ? "Connexion…" : "Se connecter en admin"}
			</button>
			<button
				type="button"
				onClick={logout}
				className="text-[12px] text-white/50 hover:text-white/70"
			>
				Fermer la session admin token
			</button>
		</form>
	);
}
