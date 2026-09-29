"use client";

/**
 * Galerie médias des fiches jeu.
 *
 * **Scindée en deux sections** — « Vidéos » puis « Images » — au lieu d'un bloc
 * unique où une bande-annonce et une capture d'écran se disputaient la même
 * vignette : on ne savait pas ce qu'on allait ouvrir, et la section s'étirait
 * sur toute la hauteur de la fiche. Séparées, chacune respire et se parcourt
 * pour ce qu'elle est.
 *
 * **Défilement automatique** sur les images : la galerie avance seule toutes
 * les 5 s pour montrer ce que la fiche contient. Elle s'arrête dès qu'on
 * interagit (survol, focus, clic sur une vignette), quand l'onglet passe en
 * arrière-plan, et n'existe pas du tout si le visiteur a demandé moins
 * d'animations. Une vidéo ne défile jamais toute seule — on n'interrompt pas
 * une lecture en cours.
 *
 * **Vidéos retirées écartées** : une vidéo supprimée ou passée en privé sur
 * YouTube laissait une vignette grise et un lecteur « Vidéo non disponible ».
 * La base n'en sait rien (le lien reste valide) ; c'est la vignette qui le dit.
 * La vidéo disparaît alors de la galerie, et la section avec elle si c'était
 * la seule.
 */
import { Film, ImageIcon, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReglages } from "@/lib/use-capacites";
import { assetUrl } from "@/lib/assets";
import { youtubeEmbedUrl, youtubeThumbUrl } from "@/lib/youtube";

export type GalleryMedia = {
	type: "image" | "youtube";
	url: string;
	caption?: string | null;
};

function resolvePreview(item: GalleryMedia): {
	kind: "image" | "youtube";
	src: string;
	thumb: string | null;
} | null {
	if (item.type === "youtube") {
		const embed = youtubeEmbedUrl(item.url);
		if (!embed) return null;
		return { kind: "youtube", src: embed, thumb: youtubeThumbUrl(item.url) };
	}
	const src = item.url.startsWith("http") ? item.url : assetUrl(item.url);
	return { kind: "image", src, thumb: src };
}

/**
 * Largeur de l'image que `i.ytimg.com` renvoie, avec un statut 404, pour une
 * vidéo retirée ou privée : un gris uniforme de 120 × 90. Une vraie vignette
 * `hqdefault` fait toujours 480 × 360. Le corps de la réponse étant une image
 * valide, le navigateur peut déclencher `load` plutôt que `error` : on écarte
 * donc sur l'un OU l'autre signal, la taille couvrant le premier cas.
 */
const LARGEUR_VIGNETTE_ABSENTE = 120;

/**
 * Clés des vidéos dont la vignette YouTube signale l'indisponibilité.
 *
 * Sondage côté client, une requête par vidéo (la même URL que la vignette
 * affichée : le cache HTTP la sert une seule fois). Chaque clé n'est ajoutée
 * qu'une fois ; aucun nouvel essai n'est lancé pour une vidéo écartée.
 */
function useVideosIndisponibles(items: ReadonlyArray<ItemResolu>): ReadonlySet<string> {
	const [absentes, setAbsentes] = useState<ReadonlySet<string>>(() => new Set());

	useEffect(() => {
		let actif = true;
		const sondes: HTMLImageElement[] = [];
		for (const item of items) {
			if (item.kind !== "youtube" || !item.thumb) continue;
			const img = new Image();
			const ecarter = () => {
				if (!actif) return;
				setAbsentes((prev) => (prev.has(item.key) ? prev : new Set(prev).add(item.key)));
			};
			img.onload = () => {
				if (img.naturalWidth <= LARGEUR_VIGNETTE_ABSENTE) ecarter();
			};
			img.onerror = ecarter;
			img.src = item.thumb;
			sondes.push(img);
		}
		return () => {
			actif = false;
			for (const img of sondes) {
				img.onload = null;
				img.onerror = null;
			}
		};
	}, [items]);

	return absentes;
}

export function GameMediaGallery({ media, title }: { media: GalleryMedia[]; title: string }) {
	const items = useMemo(
		() =>
			media
				.map((m, i) => {
					const resolved = resolvePreview(m);
					if (!resolved) return null;
					return { ...m, ...resolved, key: `${m.type}-${i}-${m.url}` };
				})
				.filter((x): x is NonNullable<typeof x> => x != null),
		[media]
	);

	const indisponibles = useVideosIndisponibles(items);
	const videos = useMemo(
		() => items.filter((i) => i.kind === "youtube" && !indisponibles.has(i.key)),
		[items, indisponibles]
	);
	const images = useMemo(() => items.filter((i) => i.kind === "image"), [items]);

	if (videos.length === 0 && images.length === 0) return null;

	return (
		<div className="mb-12 space-y-10">
			{videos.length > 0 && (
				<Galerie titre="Vidéos" items={videos} title={title} autoplay={false} />
			)}
			{images.length > 0 && (
				<Galerie titre="Images" items={images} title={title} autoplay={images.length > 1} />
			)}
		</div>
	);
}

type ItemResolu = GalleryMedia & {
	kind: "image" | "youtube";
	src: string;
	thumb: string | null;
	key: string;
};

const DELAI_AUTO_MS = 5000;

function Galerie({
	titre,
	items,
	title,
	autoplay,
}: {
	titre: string;
	items: ItemResolu[];
	title: string;
	autoplay: boolean;
}) {
	const [active, setActive] = useState(0);
	// `null` tant qu'on n'a pas interrogé les préférences système : on ne lance
	// rien avant de savoir si l'animation est la bienvenue.
	const [enMarche, setEnMarche] = useState<boolean | null>(null);
	const suspendu = useRef(false);
	const current = items[Math.min(active, Math.max(0, items.length - 1))];

	// `lectureAuto` porte à la fois le choix de l'utilisateur
	// (`prefers-reduced-motion`) et l'état de sa machine et de sa connexion :
	// faire défiler des images toutes les 5 s sur un mobile en 2G dépense des
	// données pour un carrousel que personne n'a demandé.
	const { lectureAuto } = useReglages();
	useEffect(() => {
		if (!autoplay) return;
		setEnMarche(lectureAuto);
	}, [autoplay, lectureAuto]);

	useEffect(() => {
		if (!autoplay || enMarche !== true) return;
		const id = setInterval(() => {
			// L'onglet en arrière-plan continuerait d'avancer pour personne, et
			// laisserait le visiteur revenir sur une image qu'il n'a pas choisie.
			if (suspendu.current || document.hidden) return;
			setActive((i) => (i + 1) % items.length);
		}, DELAI_AUTO_MS);
		return () => clearInterval(id);
	}, [autoplay, enMarche, items.length]);

	const choisir = useCallback((i: number) => {
		setActive(i);
		// Un clic est une intention : on rend la main, on ne reprend pas la main
		// trois secondes plus tard sur une autre image.
		setEnMarche(false);
	}, []);

	if (!current) return null;

	return (
		<section aria-label={`${titre} — ${title}`}>
			<div className="mb-4 flex items-center justify-between gap-4 border-b border-white/10 pb-2">
				<h2 className="font-display text-[20px] font-bold text-white">
					{titre}
					<span className="ml-2 font-mono text-[13px] font-normal text-white/45">
						{items.length}
					</span>
				</h2>
				{autoplay && enMarche !== null && (
					<button
						type="button"
						onClick={() => setEnMarche((v) => !v)}
						aria-label={enMarche ? "Arrêter le défilement" : "Reprendre le défilement"}
						className="inline-flex items-center gap-1.5 rounded-full border border-white/12 px-3 py-1.5 text-[11px] font-semibold text-white/60 transition-colors hover:border-dbz-orange/50 hover:text-white"
					>
						{enMarche ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
						{enMarche ? "Pause" : "Lecture"}
					</button>
				)}
			</div>

			<div
				className="overflow-hidden rounded-xl border border-white/[0.08] bg-black/40"
				onPointerEnter={() => (suspendu.current = true)}
				onPointerLeave={() => (suspendu.current = false)}
				onFocusCapture={() => (suspendu.current = true)}
				onBlurCapture={() => (suspendu.current = false)}
			>
				{/* Preview principale */}
				<div className="relative aspect-video w-full bg-black">
					{current?.kind === "youtube" ? (
						<iframe
							key={current.key}
							src={current.src}
							title={current.caption || `${title} — vidéo`}
							className="absolute inset-0 h-full w-full"
							allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
							allowFullScreen
							loading="lazy"
							referrerPolicy="strict-origin-when-cross-origin"
						/>
					) : (
						<img
							key={current.key}
							src={current.src}
							alt={current.caption || `${title} — capture`}
							// `animate-[fadeIn]` : sans fondu, le passage automatique d'une
							// image à l'autre est un à-coup sec au milieu de la lecture.
							className="absolute inset-0 h-full w-full animate-[fade-in_400ms_ease-out] object-contain"
						/>
					)}
				</div>

				{current?.caption && (
					<p className="border-t border-white/[0.06] px-4 py-2 text-center text-[12px] text-white/55">
						{current.caption}
					</p>
				)}

				{/* Vignettes */}
				{items.length > 1 && (
					<div className="flex gap-2 overflow-x-auto border-t border-white/[0.06] bg-black/50 p-3 scrollbar-thin">
						{items.map((item, i) => {
							const isActive = i === active;
							return (
								<button
									key={item.key}
									type="button"
									onClick={() => choisir(i)}
									aria-label={
										item.caption || (item.kind === "youtube" ? `Vidéo ${i + 1}` : `Image ${i + 1}`)
									}
									aria-current={isActive ? "true" : undefined}
									className={`relative h-16 w-28 shrink-0 overflow-hidden rounded-md border-2 transition-all ${
										isActive
											? "border-dbz-orange shadow-[0_0_10px_rgba(255,178,0,0.35)]"
											: "border-white/10 hover:border-white/30"
									}`}
								>
									{item.thumb ? (
										<img
											src={item.thumb}
											alt=""
											className="h-full w-full object-cover"
											loading="lazy"
										/>
									) : (
										<span className="flex h-full w-full items-center justify-center bg-zinc-900 text-white/50">
											{item.kind === "youtube" ? (
												<Film className="h-5 w-5" />
											) : (
												<ImageIcon className="h-5 w-5" />
											)}
										</span>
									)}
									{item.kind === "youtube" && (
										<span className="absolute inset-0 flex items-center justify-center bg-black/35">
											<span className="rounded-full bg-black/70 p-1.5 text-white">
												<Film className="h-3.5 w-3.5" />
											</span>
										</span>
									)}
								</button>
							);
						})}
					</div>
				)}
			</div>
		</section>
	);
}
