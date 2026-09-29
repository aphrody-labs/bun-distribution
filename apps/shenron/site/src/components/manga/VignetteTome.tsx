import Link from "next/link";
import Image from "next/image";
import { assetUrl } from "@/lib/assets";
import { CadreCase, PastilleTome } from "@/components/MotifsCouverture";

export interface VignetteVolume {
	id: number;
	volumeNumber: number;
	title: string | null;
	cover: string | null;
	/** Verified bibliographic source for the volume, when available. */
	sourceUrl?: string | null;
	sourceLabel?: string | null;
}

/**
 * Vignette d'un tome, dessinée comme le support : la couverture est encadrée du
 * cadre de case (encre / liseré jaune / encre, coins vifs) et le numéro est
 * porté par la pastille orange en bas à droite — les deux places exactes qu'ils
 * occupent sur un tankōbon.
 *
 * Trois grilles rendaient auparavant le même bloc avec trois variantes de
 * couleur ; elles passent maintenant par ici.
 */
export function VignetteTome({
	volume,
	href,
	idx = 0,
	couleur = false,
	status,
	priority = false,
}: {
	volume: VignetteVolume;
	href: string;
	idx?: number;
	/** Édition couleur : accent fuchsia et badge. */
	couleur?: boolean;
	/** État éditorial mesuré par la présence de chapitres lisibles. */
	status?: "available" | "to-complete";
	priority?: boolean;
}) {
	const titre = volume.title ?? `Tome ${volume.volumeNumber}`;
	return (
		<div className="group" style={{ animationDelay: `${idx * 0.02}s` }}>
			<Link
				href={href}
				className={`block transition-transform duration-300 hover:scale-105 ${couleur ? "hover:brightness-110" : ""}`}
			>
				<CadreCase largeur={220} className="overflow-visible">
					<div className="relative aspect-[2/3] overflow-hidden bg-dbz-bg">
						<div className="halftone pointer-events-none absolute inset-0 z-10 opacity-10" />
						{volume.cover ? (
							<Image
								src={assetUrl(volume.cover)}
								alt={titre}
								fill
								sizes="(max-width: 768px) 50vw, 16vw"
								className="object-cover opacity-90 transition-all duration-500 group-hover:scale-105 group-hover:opacity-100"
								priority={priority}
							/>
						) : (
							<div className="grid h-full w-full place-items-center bg-zinc-900">
								<span className="font-saiyan select-none text-5xl text-white/20">
									{volume.volumeNumber}
								</span>
							</div>
						)}
						<div className="absolute inset-0 z-20 bg-gradient-to-t from-black via-black/35 to-transparent" />
						{couleur && (
							<span className="absolute top-2 left-2 z-30 rounded bg-gradient-to-r from-fuchsia-500 to-amber-400 px-2 py-0.5 font-mono text-[9px] font-black tracking-wider text-black uppercase">
								Couleur
							</span>
						)}
						{status === "to-complete" && (
							<span className="absolute top-2 right-2 z-30 rounded bg-black/80 px-2 py-0.5 font-mono text-[9px] font-bold tracking-wider text-white/80 uppercase">
								À compléter
							</span>
						)}
						<div className="absolute inset-x-0 bottom-0 z-30 flex items-end justify-between gap-2 p-3">
							<p
								className={`font-display line-clamp-2 text-sm font-bold text-white transition-colors ${
									couleur ? "group-hover:text-fuchsia-300" : "group-hover:text-dbz-orange"
								}`}
							>
								{titre}
							</p>
							<PastilleTome numero={volume.volumeNumber} taille={38} surImage />
						</div>
					</div>
				</CadreCase>
			</Link>
			{volume.sourceUrl && (
				<a
					href={volume.sourceUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="mt-2 block text-center font-mono text-[10px] font-bold uppercase tracking-wider text-dbz-orange hover:text-white"
				>
					{volume.sourceLabel ?? "Source bibliographique"} ↗
				</a>
			)}
		</div>
	);
}
