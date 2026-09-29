/**
 * Rendu d'une sous-catégorie PWS (power scaling) — carte scouter dédiée.
 * Utilisé sur les fiches personnage pour le bloc power scaling.
 */
import { WikiMarkdown } from "@/components/wiki/WikiMarkdown";
import {
	normalizeSectionAccent,
	sectionAccentStyle,
	type SectionAccent,
} from "@/lib/wiki-section-accents";

export function PwsStatSection({
	label,
	body,
	accent = "red",
}: {
	label: string;
	body: string;
	accent?: SectionAccent | null;
}) {
	const a = normalizeSectionAccent(accent);
	const style = sectionAccentStyle(a);
	const trimmed = body.trim();
	// Corps court (1–2 lignes sans markdown lourd) → grand chiffre scouter.
	const shortStat =
		trimmed &&
		!/^#{1,6}\s/m.test(trimmed) &&
		!/[*_`>[]/m.test(trimmed) &&
		trimmed.length <= 80 &&
		trimmed.split("\n").filter(Boolean).length <= 2;

	return (
		<section className="dbz-panel relative overflow-hidden border-l-4 border-l-dbz-orange/80 p-6 sm:p-8">
			{/* Trame scouter */}
			<div className="pointer-events-none absolute inset-0 opacity-[0.07]">
				<div className="halftone absolute inset-0" />
			</div>
			<div className="relative z-10 space-y-4">
				<div className="flex flex-wrap items-center gap-3">
					<span className="inline-flex items-center gap-1.5 rounded border border-white/15 bg-black/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-dbz-blue-light">
						<span className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`} />
						PWS
					</span>
					<h2 className="font-saiyan text-2xl uppercase tracking-widest text-white sm:text-3xl">
						{label}
					</h2>
				</div>

				{!trimmed ? (
					<p className="text-sm italic text-white/50">
						Section power scaling à compléter — éditable dans le studio (Pack PWS).
					</p>
				) : shortStat ? (
					<p
						className={`scouter-text text-3xl sm:text-4xl md:text-5xl ${style.pillActive.includes("text-") ? "" : "text-dbz-orange"} leading-tight`}
					>
						<span className="text-dbz-orange drop-shadow-[0_0_12px_rgba(255,178,0,0.35)]">
							{trimmed}
						</span>
					</p>
				) : (
					<div className="prose prose-invert max-w-none wiki-content text-white/85">
						<WikiMarkdown body={trimmed} />
					</div>
				)}
			</div>
		</section>
	);
}
