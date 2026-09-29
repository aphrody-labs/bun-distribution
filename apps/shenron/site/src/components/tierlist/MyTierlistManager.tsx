"use client";

import { useState } from "react";
import Link from "next/link";
import { TierlistView } from "./TierlistView";
import type { TierlistTier } from "@/db/schema";

export interface MyTierlistItem {
	id: string;
	slug: string;
	title: string;
	tiers: TierlistTier[];
}

/**
 * Gestion de ses propres tierlists : aperçu + suppression (confirmation en deux
 * clics, sans `window.confirm`). Appelle DELETE /api/tierlists/[id].
 */
export function MyTierlistManager({ initial }: { initial: MyTierlistItem[] }) {
	const [items, setItems] = useState(initial);
	const [confirmId, setConfirmId] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function remove(id: string) {
		if (confirmId !== id) {
			setConfirmId(id);
			return;
		}
		setBusy(id);
		setError(null);
		try {
			const res = await fetch(`/api/tierlists/${id}`, { method: "DELETE" });
			if (res.ok) {
				setItems((prev) => prev.filter((t) => t.id !== id));
			} else {
				const d = await res.json().catch(() => ({}));
				setError(d?.error ?? "Échec de la suppression.");
			}
		} catch {
			setError("Réseau indisponible.");
		}
		setBusy(null);
		setConfirmId(null);
	}

	if (items.length === 0) {
		return (
			<p className="text-center text-white/55">
				Tu n'as pas encore de tierlist.{" "}
				<Link href="/tierlists/creer" className="font-bold text-dbz-orange hover:underline">
					Créer la première
				</Link>
				.
			</p>
		);
	}

	return (
		<>
			{error && <p className="mb-4 text-center text-[13px] font-semibold text-rose-400">{error}</p>}
			<div className="grid gap-6 sm:grid-cols-2">
				{items.map((t) => (
					<div key={t.id} className="dbz-panel p-4">
						<div className="mb-3 flex items-center justify-between gap-2">
							<Link
								href={`/tierlists/${t.slug}`}
								className="truncate text-lg font-bold text-white hover:text-dbz-orange"
							>
								{t.title}
							</Link>
							<button
								type="button"
								onClick={() => remove(t.id)}
								disabled={busy === t.id}
								className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
									confirmId === t.id
										? "bg-rose-500 text-white"
										: "text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
								}`}
							>
								{busy === t.id ? "…" : confirmId === t.id ? "Confirmer ?" : "Supprimer"}
							</button>
						</div>
						<TierlistView tiers={t.tiers} compact />
					</div>
				))}
			</div>
		</>
	);
}
