import Image from "next/image";
import { FlecheCoin, Lecture } from "@/components/icones";
import { assetUrl } from "@/lib/assets";
import { isEditableAsset } from "@/lib/images";

/**
 * QuickLook — contenu de l'aperçu rapide (modale d'interception). Backdrop large
 * en haut avec titre + bouton Regarder superposés, puis détails (affiche, méta,
 * synopsis) dessous. Server Component (aucun JS) — la modale qui l'enveloppe
 * (`Modal`) porte l'interactivité. `watchHref` pointe la fiche pleine page.
 */
export function QuickLook({
	backdrop,
	poster,
	eyebrow,
	title,
	titleJa,
	meta,
	synopsis,
	hasVf,
	hasVostfr,
	resources,
	watchHref,
	watchLabel,
}: {
	backdrop: string;
	poster?: string | null;
	eyebrow: string;
	title: string;
	titleJa?: string | null;
	meta?: (string | null | undefined)[];
	synopsis?: string | null;
	hasVf?: boolean;
	hasVostfr?: boolean;
	/** Indicateurs calculés depuis la fiche vidéo (lecteurs, sous-titres, etc.). */
	resources?: string[];
	watchHref: string;
	watchLabel: string;
}) {
	const metaParts = (meta ?? []).filter(Boolean) as string[];
	return (
		<div className="max-h-[88vh] overflow-y-auto">
			{/* Backdrop + titre superposé */}
			<div className="relative aspect-video w-full overflow-hidden bg-black">
				<Image
					src={backdrop}
					alt=""
					fill
					// Le panneau plafonne à 768 px mais reste plus étroit que le viewport
					// sous ce seuil : un `sizes` fixe faisait charger la variante 828 px
					// sur un téléphone qui n'en affiche que ~350.
					sizes="(min-width: 800px) 768px, 100vw"
					quality={70}
					unoptimized={isEditableAsset(backdrop)}
					priority
					className="object-cover"
				/>
				<div className="absolute inset-0 bg-gradient-to-t from-dbz-card via-dbz-card/30 to-transparent" />
				<div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
					<p className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.18em] text-dbz-orange">
						{eyebrow}
					</p>
					<h2
						id="stream-modal-title"
						className="title-gold font-saiyan text-3xl font-bold uppercase leading-tight sm:text-4xl"
					>
						{title}
					</h2>
					{titleJa && <p className="mt-1 font-jp text-[13px] text-white/60">{titleJa}</p>}
					{/* Navigation DURE (`<a>`, pas `<Link>`) : la modale est déjà à l'URL
					    `watchHref` (interceptée) → un soft-nav rouvrirait la modale ; un
					    hard-nav charge bien la fiche pleine page (lecteur inclus). */}
					<div className="mt-4 flex flex-wrap items-center gap-3">
						<a
							href={watchHref}
							className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-dbz-orange px-5 py-2.5 font-display text-[14px] font-bold text-black shadow-lg transition-colors hover:bg-dbz-orange-dark"
						>
							<Lecture className="h-4 w-4 fill-current" />
							{watchLabel}
						</a>
						<a
							href={watchHref}
							className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-white/12 px-4 py-2.5 font-display text-[13px] font-semibold text-white backdrop-blur transition-colors hover:bg-white/20"
						>
							Fiche complète
							<FlecheCoin className="h-4 w-4" />
						</a>
					</div>
				</div>
			</div>

			{/* Détails */}
			<div className="flex gap-5 p-5 sm:p-7">
				{poster && (
					<div className="relative hidden aspect-[2/3] w-28 shrink-0 overflow-hidden rounded-lg ring-1 ring-white/10 sm:block">
						<Image
							src={assetUrl(poster)}
							alt=""
							fill
							sizes="112px"
							quality={70}
							unoptimized={isEditableAsset(poster)}
							className="object-cover"
						/>
					</div>
				)}
				<div className="min-w-0 flex-1 space-y-3">
					{(metaParts.length > 0 || hasVf || hasVostfr || resources?.length) && (
						<div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] font-display font-semibold uppercase tracking-wide text-white/65">
							{metaParts.map((m, i) => (
								<span key={i}>{m}</span>
							))}
							{hasVf && (
								<span className="rounded bg-namek/85 px-1.5 py-0.5 text-[10px] text-black">VF</span>
							)}
							{hasVostfr && (
								<span className="rounded bg-dbz-blue-light/85 px-1.5 py-0.5 text-[10px] text-black">
									VOSTFR
								</span>
							)}
							{resources?.map((resource) => (
								<span
									key={resource}
									className="rounded bg-white/10 px-2 py-1 text-[10px] text-white/65"
								>
									{resource}
								</span>
							))}
						</div>
					)}
					{/* Pas de « Synopsis à venir » : on masque le champ vide, on ne le
					    meuble pas (DESIGN.md § À éviter). Une promesse tenue par personne
					    vieillit mal, et l'aperçu garde son titre et sa vignette. */}
					{synopsis && <p className="text-[14px] leading-relaxed text-white/75">{synopsis}</p>}
				</div>
			</div>
		</div>
	);
}
