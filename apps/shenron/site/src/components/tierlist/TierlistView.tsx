import { assetUrl } from "@/lib/assets";
import type { TierlistTier } from "@/db/schema";

/**
 * Rendu lecture seule d'une tierlist (pages publiques + aperçu d'index).
 * Composant présentation pur (pas de `use client`) → rendu côté serveur.
 */
export function TierlistView({
	tiers,
	compact = false,
}: {
	tiers: TierlistTier[];
	compact?: boolean;
}) {
	const cell = compact ? "h-9 w-9" : "h-14 w-14 sm:h-16 sm:w-16";
	const label = compact ? "w-9 text-sm" : "w-14 sm:w-16 text-lg";
	return (
		<div className="flex flex-col gap-1.5">
			{tiers.map((t) => (
				<div key={t.id} className="flex overflow-hidden rounded-lg border border-white/10">
					<div
						className={`flex ${label} shrink-0 items-center justify-center font-black text-black/85`}
						style={{ background: t.color }}
					>
						{t.label}
					</div>
					<div className="flex flex-1 flex-wrap content-start gap-1 bg-black/30 p-1.5">
						{t.items.map((it) => (
							<span
								key={it.id}
								title={it.label}
								className={`relative block ${cell} shrink-0 overflow-hidden rounded-md border border-white/10 bg-white/5`}
							>
								{it.image ? (
									<img
										src={assetUrl(it.image)}
										alt={it.label}
										loading="lazy"
										className="h-full w-full object-cover object-top"
									/>
								) : (
									<span className="flex h-full w-full items-center justify-center px-0.5 text-center text-[8px] font-semibold leading-tight text-white/70">
										{it.label}
									</span>
								)}
							</span>
						))}
						{t.items.length === 0 && (
							<span className="px-2 py-1 text-[11px] italic text-white/50">—</span>
						)}
					</div>
				</div>
			))}
		</div>
	);
}
