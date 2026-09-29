import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { Info, Lecture } from "@/components/icones";
import { assetUrl } from "@/lib/assets";
import { isEditableAsset } from "@/lib/images";
import { BackgroundImage } from "@/components/media/BackgroundImage";

/**
 * Billboard — bannière héro « à la Netflix » en tête des catalogues (films,
 * épisodes, chronologie). Backdrop large (BackgroundImage ken-burns, LCP
 * priority) fondu dans le fond de page (dégradés vers `dbz-bg`) + titre géant,
 * méta, synopsis et boutons d'action. Server Component (aucun JS).
 *
 * Les films n'ayant pas d'image large, on passe une bannière officielle en
 * `backdrop` et l'affiche portrait en `poster` (affichée nette à droite).
 */
export function Billboard({
	backdrop,
	poster,
	eyebrow,
	title,
	titleJa,
	meta,
	synopsis,
	hasVf,
	hasVostfr,
	primaryHref,
	primaryLabel,
	primaryHardNav = false,
	secondaryHref,
	secondaryLabel,
}: {
	/** URL large déjà résolue (assetUrl(...) ou bannière). */
	backdrop: string;
	/** Affiche portrait (chemin brut → assetUrl interne), affichée nette à droite. */
	poster?: string | null;
	eyebrow: ReactNode;
	title: ReactNode;
	titleJa?: string | null;
	meta?: (ReactNode | null | undefined)[];
	synopsis?: ReactNode | null;
	hasVf?: boolean;
	hasVostfr?: boolean;
	primaryHref: string;
	primaryLabel: ReactNode;
	/** Navigation DURE (`<a>`) pour l'action primaire — utile quand le catalogue
	 *  intercepte `/wiki/.../[id]` en modale mais qu'on veut aller à la fiche
	 *  (ex. billboard films « Regarder le film » → vraie fiche, pas l'aperçu). */
	primaryHardNav?: boolean;
	secondaryHref?: string;
	secondaryLabel?: ReactNode;
}) {
	const metaParts = (meta ?? []).filter(Boolean) as ReactNode[];
	return (
		<section className="relative h-[70vh] max-h-[680px] min-h-[440px] w-full overflow-hidden border-b border-white/[0.08]">
			<BackgroundImage src={backdrop} alt="" variant="kenburns" overlay="none" priority />
			{/* Fondus vers le fond de page pour un raccord invisible avec les rails */}
			<div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-dbz-bg via-dbz-bg/45 to-dbz-bg/10" />
			<div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-dbz-bg/95 via-dbz-bg/40 to-transparent" />
			{/* Trame demi-teinte + lignes de vitesse (identité planche Toriyama) */}
			<div
				aria-hidden
				className="halftone pointer-events-none absolute inset-0 opacity-[0.06] mix-blend-overlay"
			/>
			<div
				aria-hidden
				className="speed-lines pointer-events-none absolute inset-0 opacity-[0.04]"
			/>

			<div className="relative z-10 mx-auto flex h-full max-w-[1400px] items-end px-6 pb-12 lg:px-10 lg:pb-16">
				<div className="flex w-full items-end gap-8">
					{/* min-w-0 : sans ça, ce flex-1 ne descend pas sous la largeur de son
					    contenu (min-width:auto) → titre/synopsis débordent sur mobile. */}
					<div className="reveal-up min-w-0 max-w-2xl flex-1">
						<p className="mb-3 inline-flex items-center gap-3 font-display text-[12px] font-semibold uppercase tracking-[0.18em] text-dbz-orange">
							<span aria-hidden className="h-px w-7 bg-dbz-orange/70" />
							{eyebrow}
						</p>
						<h1 className="title-gold mb-3 hyphens-auto break-words font-saiyan text-[27px] font-bold uppercase leading-[1.05] tracking-[0.01em] sm:text-[38px] sm:leading-[1.02] md:text-[56px]">
							{title}
						</h1>
						{titleJa && <p className="mb-3 font-jp text-[15px] text-white/55">{titleJa}</p>}

						{(metaParts.length > 0 || hasVf || hasVostfr) && (
							<div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] font-display font-semibold uppercase tracking-wide text-white/70">
								{metaParts.map((m, i) => (
									<span key={i} className="flex items-center gap-3">
										{i > 0 && (
											<span aria-hidden className="text-white/25">
												·
											</span>
										)}
										{m}
									</span>
								))}
								{hasVf && (
									<span className="rounded bg-namek/85 px-1.5 py-0.5 text-[10px] text-black">
										VF
									</span>
								)}
								{hasVostfr && (
									<span className="rounded bg-dbz-blue-light/85 px-1.5 py-0.5 text-[10px] text-black">
										VOSTFR
									</span>
								)}
							</div>
						)}

						{synopsis && (
							<p className="mb-6 line-clamp-3 max-w-xl text-[15px] leading-relaxed text-white/80">
								{synopsis}
							</p>
						)}

						<div className="flex flex-wrap items-center gap-3">
							{primaryHardNav ? (
								// Nav dure : contourne l'interception @modal du catalogue → fiche
								// pleine page (lecteur) plutôt qu'un aperçu.
								<a
									href={primaryHref}
									className="inline-flex items-center gap-2 rounded-lg bg-dbz-orange px-6 py-3 font-display text-[15px] font-bold text-black shadow-lg transition-colors hover:bg-dbz-orange-dark"
								>
									<Lecture className="h-5 w-5 fill-current" />
									{primaryLabel}
								</a>
							) : (
								<Link
									href={primaryHref}
									className="inline-flex items-center gap-2 rounded-lg bg-dbz-orange px-6 py-3 font-display text-[15px] font-bold text-black shadow-lg transition-colors hover:bg-dbz-orange-dark"
								>
									<Lecture className="h-5 w-5 fill-current" />
									{primaryLabel}
								</Link>
							)}
							{secondaryHref && secondaryLabel && (
								<Link
									href={secondaryHref}
									className="inline-flex items-center gap-2 rounded-lg bg-white/12 px-6 py-3 font-display text-[15px] font-bold text-white backdrop-blur transition-colors hover:bg-white/20"
								>
									<Info className="h-5 w-5" />
									{secondaryLabel}
								</Link>
							)}
						</div>
					</div>

					{poster && (
						<div className="hidden shrink-0 lg:block">
							<div className="relative aspect-[2/3] w-44 overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10">
								<Image
									src={assetUrl(poster)}
									alt=""
									fill
									sizes="176px"
									quality={70}
									// Affiche téléversée depuis l'admin : servie telle quelle pour rester
									// fraîche dès son remplacement (cf. lib/images.ts) — comme le font
									// déjà PosterCard et EpisodeCard.
									unoptimized={isEditableAsset(poster)}
									className="object-cover"
								/>
							</div>
						</div>
					)}
				</div>
			</div>
		</section>
	);
}
