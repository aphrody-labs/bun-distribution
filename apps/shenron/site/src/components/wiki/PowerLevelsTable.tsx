"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PowerLevel } from "@/lib/db-universe";
import { CHARACTER_CANONICAL_SLUGS } from "@/lib/wiki-slugs";
import { isPathPublic, type AccessSnapshot } from "@/lib/wiki-launch";

const SOURCE_LABELS: Record<string, string> = {
	ALL: "Toutes les sources",
	scouter_manga: "Scouter (Manga Canon)",
	daizenshuu_7: "Daizenshuu 7 (Officiel)",
	kiri_babidi: "Unités Kiri (Babidi)",
};

/** `access` : instantané de lancement résolu par la page serveur (cf. `ClientGatedWrap`). */
export function PowerLevelsTable({
	powers,
	access,
}: {
	powers: PowerLevel[];
	access?: AccessSnapshot | null;
}) {
	const ouvert = (href: string) => !access || isPathPublic(href, access);
	const [query, setQuery] = useState("");
	const [sourceFilter, setSourceFilter] = useState("ALL");
	const [sortBy, setSortBy] = useState<"asc" | "desc">("desc");

	const filtered = useMemo(() => {
		const q = query.toLowerCase().trim();
		const list = powers.filter((p) => {
			if (sourceFilter !== "ALL" && p.source_kind !== sourceFilter) return false;
			if (!q) return true;

			const inChar = p.character_name.toLowerCase().includes(q);
			const inForm = p.form?.toLowerCase().includes(q) ?? false;
			const inSaga = p.saga_name?.toLowerCase().includes(q) ?? false;
			const inNotes = p.notes?.toLowerCase().includes(q) ?? false;

			return inChar || inForm || inSaga || inNotes;
		});

		return list.toSorted((a, b) => {
			const valA = a.battle_power ?? 0;
			const valB = b.battle_power ?? 0;
			return sortBy === "desc" ? valB - valA : valA - valB;
		});
	}, [powers, query, sourceFilter, sortBy]);

	return (
		<div className="space-y-6">
			{/* Multiplicateurs Officiels Toriyama, Daizenshuu 7 & Super Exciting Guide */}
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
				<div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col justify-between">
					<div>
						<div className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
							Ôzaru (Singe Géant)
						</div>
						<div className="text-lg font-extrabold text-white mt-1">Multiplicateur ×10</div>
					</div>
					<p className="text-[11px] text-white/50 mt-2 leading-relaxed">
						L&apos;onde Blutz de la pleine lune stimule la queue saiyenne et décuple la force brute (Vegeta 18 000 → 180 000).
					</p>
				</div>

				<div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col justify-between">
					<div>
						<div className="text-[10px] font-bold uppercase tracking-wider text-red-400">
							Technique Kaiô-ken
						</div>
						<div className="text-lg font-extrabold text-white mt-1">Multiplicateur ×2 à ×20</div>
					</div>
					<p className="text-[11px] text-white/50 mt-2 leading-relaxed">
						Multiplie directement le ki de base. Poussé jusqu&apos;au Kaiô-ken ×20 sur Namek (Goku 3M → 60M face à Freeza).
					</p>
				</div>

				<div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col justify-between">
					<div>
						<div className="text-[10px] font-bold uppercase tracking-wider text-yellow-400">
							Super Saiyan 1
						</div>
						<div className="text-lg font-extrabold text-white mt-1">Multiplicateur ×50</div>
					</div>
					<p className="text-[11px] text-white/50 mt-2 leading-relaxed">
						Multiplie la force de base par 50 (Daizenshuu 7 & Toriyama : base 3M → 150M sur Namek).
					</p>
				</div>

				<div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col justify-between">
					<div>
						<div className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
							Super Saiyan 2 & 3
						</div>
						<div className="text-lg font-extrabold text-white mt-1">×100 et ×400</div>
					</div>
					<p className="text-[11px] text-white/50 mt-2 leading-relaxed">
						Super Exciting Guide : le SSJ2 double le SSJ1 (×100 de base), le SSJ3 quadruple le SSJ2 (×400 de base).
					</p>
				</div>

				<div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col justify-between">
					<div>
						<div className="text-[10px] font-bold uppercase tracking-wider text-purple-400">
							Unités Kiri (Babidi)
						</div>
						<div className="text-lg font-extrabold text-white mt-1">1 Kiri = 50 000 BP</div>
					</div>
					<p className="text-[11px] text-white/50 mt-2 leading-relaxed">
						Dispositif magique de Babidi : Yakon = 800 Kiri (40M) ; Goku SSJ2 = 3 000 Kiri (150M) au minimum.
					</p>
				</div>
			</div>

			{/* Contrôles de filtrage */}
			<div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-black/40 p-4 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
				<div className="relative flex-1">
					<input
						type="search"
						aria-label="Rechercher un niveau de puissance"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Rechercher un personnage, une forme, un chiffre (ex: Goku, 150 000 000, Raditz)..."
						className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
					/>
					{query && (
						<button
							type="button"
							onClick={() => setQuery("")}
							className="absolute right-3 top-2.5 text-xs text-white/50 hover:text-white"
						>
							Effacer
						</button>
					)}
				</div>

				<div className="flex flex-wrap items-center gap-2">
					{Object.entries(SOURCE_LABELS).map(([k, label]) => (
						<button
							key={k}
							type="button"
							onClick={() => setSourceFilter(k)}
							className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
								sourceFilter === k
									? "bg-orange-600 text-white shadow-md shadow-orange-950/40"
									: "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
							}`}
						>
							{label}
						</button>
					))}

					<button
						type="button"
						onClick={() => setSortBy(sortBy === "desc" ? "asc" : "desc")}
						className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 hover:text-white"
					>
						Tri : {sortBy === "desc" ? "Plus fort ↓" : "Plus faible ↑"}
					</button>
				</div>
			</div>

			{/* Tableau des Battle Powers */}
			<div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
				<table className="w-full text-left text-sm text-white/80">
					<thead className="border-b border-white/10 bg-white/[0.04] text-xs uppercase tracking-wider text-white/50">
						<tr>
							<th className="px-4 py-3">Guerrier & Forme</th>
							<th className="px-4 py-3">Période / Saga</th>
							<th className="px-4 py-3 text-right">Battle Power</th>
							<th className="px-4 py-3">Dispositif & Source</th>
							<th className="px-4 py-3 hidden md:table-cell">Contexte & Citation</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-white/5">
						{filtered.map((p) => (
							<tr key={p.id} id={`niveau-${p.id}`} className="hover:bg-white/[0.03] transition-colors">
								<td className="px-4 py-3.5">
									{p.character_id &&
									ouvert(`/wiki/personnages/${CHARACTER_CANONICAL_SLUGS[p.character_id] ?? p.character_id}`) ? (
										<Link
											href={`/wiki/personnages/${CHARACTER_CANONICAL_SLUGS[p.character_id] ?? p.character_id}`}
											className="font-bold text-white hover:text-orange-400 hover:underline transition-colors"
										>
											{p.character_name}
										</Link>
									) : (
										<div className="font-bold text-white">{p.character_name}</div>
									)}
									{p.form && <div className="text-xs text-orange-400/80">{p.form}</div>}
								</td>
								<td className="px-4 py-3.5 text-xs text-white/60">
									{p.saga_name ?? "Saga classique"}
								</td>
								<td className="px-4 py-3.5 text-right font-mono font-bold text-amber-400">
									<div className="text-base">{p.battle_power_display}</div>
									{p.battle_power && (
										<div className="w-full bg-white/5 h-1.5 rounded-full mt-1 overflow-hidden">
											<div
												className="bg-gradient-to-r from-orange-500 to-amber-400 h-full rounded-full"
												style={{
													width: `${Math.min(100, Math.max(2, (Math.log10(p.battle_power) / 8.2) * 100))}%`,
												}}
											/>
										</div>
									)}
								</td>
								<td className="px-4 py-3.5 text-xs">
									<div className="font-medium text-white/80">{p.scouter_device ?? "Mesure"}</div>
									<div className="text-[11px] text-white/40">{p.source_page}</div>
								</td>
								<td className="px-4 py-3.5 text-xs text-white/60 hidden md:table-cell max-w-xs">
									{p.notes ?? "—"}
								</td>
							</tr>
						))}
					</tbody>
				</table>

				{filtered.length === 0 && (
					<div className="p-8 text-center text-white/50 text-xs">
						Aucun niveau de puissance ne correspond à votre filtre.
					</div>
				)}
			</div>
		</div>
	);
}
