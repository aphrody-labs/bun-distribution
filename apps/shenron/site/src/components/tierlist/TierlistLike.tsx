"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Bouton « j'aime » d'une tierlist (îlot client → la page détail reste cachée).
 * Charge l'état au montage (GET), toggle au clic (POST). 401 → redirige vers la
 * connexion Discord.
 */
export function TierlistLike({ tierlistId }: { tierlistId: string }) {
	const router = useRouter();
	const [count, setCount] = useState<number | null>(null);
	const [liked, setLiked] = useState(false);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let alive = true;
		fetch(`/api/tierlists/${tierlistId}/like`, { cache: "no-store" })
			.then((r) => (r.ok ? r.json() : null))
			.then((d) => {
				if (alive && d) {
					setCount(d.count);
					setLiked(!!d.liked);
				}
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [tierlistId]);

	async function toggle() {
		if (busy) return;
		setBusy(true);
		try {
			const res = await fetch(`/api/tierlists/${tierlistId}/like`, { method: "POST" });
			if (res.status === 401) {
				const cb = encodeURIComponent(window.location.pathname);
				router.push(`/signin?callbackURL=${cb}`);
				return;
			}
			const d = await res.json().catch(() => null);
			if (res.ok && d) {
				setCount(d.count);
				setLiked(!!d.liked);
			}
		} finally {
			setBusy(false);
		}
	}

	return (
		<button
			type="button"
			onClick={toggle}
			disabled={busy}
			aria-pressed={liked}
			className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 py-2 text-sm font-bold transition-colors disabled:opacity-60 ${
				liked
					? "border-rose-500/60 bg-rose-500/15 text-rose-300"
					: "border-white/15 text-white/75 hover:border-rose-500/40 hover:text-rose-300"
			}`}
		>
			<span className="text-base leading-none">{liked ? "♥" : "♡"}</span>
			<span>{count ?? "…"}</span>
			<span className="text-white/50">j'aime</span>
		</button>
	);
}
