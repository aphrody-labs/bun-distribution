"use client";

/**
 * AnimatedMedia — afficheur d'animations de scènes Dragon Ball.
 *
 * Pour l'AFFICHAGE on privilégie un format moderne plutôt qu'un GIF lourd :
 *   - `<video autoplay muted loop playsinline>` (MP4/WebM) → le plus léger,
 *     décodage matériel, contrôle play/pause natif ;
 *   - image animée moderne (WebP/AVIF animé) ou GIF legacy → balise `<img>`.
 * Le type est auto-détecté depuis l'extension de `src`, ou forcé via `kind`.
 *
 * Optimisations intégrées :
 *   - **Lazy via IntersectionObserver** : la vidéo n'est `play()`-ée (et son
 *     `src` n'est posé) que lorsqu'elle entre dans le viewport ; pause + libère
 *     hors-champ. Les `<img>` reçoivent `loading="lazy"` natif.
 *   - **play/pause contrôlable** : overlay accessible (bouton) + clic sur le
 *     média ; état exposé via `onPlayStateChange`.
 *   - **a11y** : `prefers-reduced-motion` → pas d'autoplay, on affiche le
 *     premier frame figé (poster) ; bouton avec `aria-label` localisé ;
 *     respect du focus clavier.
 *   - **SSR-safe** : "use client", aucun accès `window`/`document` au rendu.
 *
 * Usage :
 * ```tsx
 * import { AnimatedMedia } from "@/components/media/AnimatedMedia";
 * import { assetUrl } from "@/lib/assets";
 *
 * <AnimatedMedia
 *   src={assetUrl("assets/scenes/kamehameha.mp4")}
 *   poster={assetUrl("assets/scenes/kamehameha.jpg")}
 *   alt="Kamehameha de Goku"
 *   className="aspect-video w-full rounded-lg"
 * />
 * ```
 */

import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";

export type AnimatedMediaKind = "video" | "image";

export interface AnimatedMediaProps {
	/** URL absolue (ex. assetUrl("assets/scenes/x.mp4")) ou relative same-origin. */
	src: string;
	/** Texte alternatif (a11y). Vide = décoratif (aria-hidden). */
	alt?: string;
	/** Poster affiché avant lecture / si reduced-motion. Recommandé pour le LCP. */
	poster?: string;
	/** Forcer le type ; sinon auto-détecté depuis l'extension de `src`. */
	kind?: AnimatedMediaKind;
	/** Démarrer la lecture dès l'entrée dans le viewport (défaut: true). */
	autoPlay?: boolean;
	/** Boucler (défaut: true). */
	loop?: boolean;
	/** Afficher le bouton play/pause en overlay (défaut: true pour les vidéos). */
	controls?: boolean;
	className?: string;
	style?: CSSProperties;
	/** Notifié à chaque changement d'état de lecture. */
	onPlayStateChange?: (playing: boolean) => void;
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;

function detectKind(src: string, override?: AnimatedMediaKind): AnimatedMediaKind {
	if (override) return override;
	return VIDEO_EXT.test(src) ? "video" : "image";
}

function prefersReducedMotion(): boolean {
	if (typeof window === "undefined") return false;
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function AnimatedMedia({
	src,
	alt = "",
	poster,
	kind,
	autoPlay = true,
	loop = true,
	controls,
	className = "",
	style,
	onPlayStateChange,
}: AnimatedMediaProps) {
	const resolvedKind = detectKind(src, kind);
	const showControls = controls ?? resolvedKind === "video";
	const containerRef = useRef<HTMLDivElement>(null);
	const videoRef = useRef<HTMLVideoElement>(null);
	// Pour la vidéo, on diffère la pose du src tant que pas visible (économie réseau).
	const [armed, setArmed] = useState(resolvedKind !== "video");
	const [visible, setVisible] = useState(false);
	const [playing, setPlaying] = useState(false);
	const reducedMotion = useRef(false);

	useEffect(() => {
		reducedMotion.current = prefersReducedMotion();
	}, []);

	// IntersectionObserver : arme et note la visibilité ; la LECTURE est déclenchée
	// par l'effet suivant, une fois le `src` réellement posé sur l'élément.
	useEffect(() => {
		if (resolvedKind !== "video") return;
		const el = containerRef.current;
		if (!el) return;

		const io = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						setArmed(true);
						setVisible(true);
					} else {
						setVisible(false);
						const video = videoRef.current;
						if (video && !video.paused) video.pause();
					}
				}
			},
			{ rootMargin: "200px 0px", threshold: 0.01 }
		);
		io.observe(el);
		return () => io.disconnect();
	}, [resolvedKind]);

	// Lecture un rendu APRÈS l'armement. Appeler `play()` dans le callback de
	// l'observateur échouait à chaque première entrée dans le champ : `setArmed(true)`
	// ne pose le `src` qu'au rendu suivant, donc `play()` visait un <video> encore
	// sans source et sa promesse était rejetée (NotSupportedError). Une vidéo visible
	// dès le chargement ne démarrait alors jamais — il fallait la faire sortir du
	// champ puis y revenir.
	useEffect(() => {
		if (resolvedKind !== "video" || !armed || !visible || !autoPlay) return;
		if (reducedMotion.current) return;
		const video = videoRef.current;
		if (!video) return;
		void video.play().catch(() => {
			/* autoplay refusé (politique navigateur) : on reste sur le poster */
		});
	}, [resolvedKind, armed, visible, autoPlay]);

	const handlePlay = useCallback(() => {
		setPlaying(true);
		onPlayStateChange?.(true);
	}, [onPlayStateChange]);

	const handlePause = useCallback(() => {
		setPlaying(false);
		onPlayStateChange?.(false);
	}, [onPlayStateChange]);

	const toggle = useCallback(() => {
		const video = videoRef.current;
		if (!video) return;
		if (video.paused) {
			void video.play().catch(() => undefined);
		} else {
			video.pause();
		}
	}, []);

	if (resolvedKind === "image") {
		// Image animée (WebP/AVIF/GIF) — lazy natif, pas de JS de lecture.
		return (
			<div ref={containerRef} className={`relative overflow-hidden ${className}`} style={style}>
				{/* Image animée (WebP/AVIF/GIF) servie directe par l'API bot — next/image
				    superflu (images.unoptimized) ; lazy natif via loading="lazy". */}
				<img
					src={src}
					alt={alt}
					aria-hidden={alt ? undefined : true}
					loading="lazy"
					decoding="async"
					className="h-full w-full object-cover"
				/>
			</div>
		);
	}

	return (
		<div ref={containerRef} className={`group relative overflow-hidden ${className}`} style={style}>
			<video
				ref={videoRef}
				src={armed ? src : undefined}
				poster={poster}
				muted
				loop={loop}
				playsInline
				preload="metadata"
				aria-label={alt || undefined}
				aria-hidden={alt ? undefined : true}
				onPlay={handlePlay}
				onPause={handlePause}
				className="h-full w-full object-cover"
			/>

			{showControls && (
				<button
					type="button"
					onClick={toggle}
					aria-label={playing ? "Mettre en pause" : "Lire l'animation"}
					className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors hover:bg-black/20 focus-visible:bg-black/20 focus-visible:outline-none"
				>
					<span
						aria-hidden
						className={`grid h-14 w-14 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-opacity ${
							playing ? "opacity-0 group-hover:opacity-100" : "opacity-100"
						}`}
					>
						{playing ? (
							<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
								<rect x="6" y="5" width="4" height="14" rx="1" />
								<rect x="14" y="5" width="4" height="14" rx="1" />
							</svg>
						) : (
							<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
								<path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.79-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
							</svg>
						)}
					</span>
				</button>
			)}
		</div>
	);
}
