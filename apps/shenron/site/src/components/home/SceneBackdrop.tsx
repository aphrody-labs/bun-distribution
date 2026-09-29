"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { assetUrl } from "@/lib/assets";
import type { HomeScene } from "@/lib/home-scenes";
import { isEditableAsset } from "@/lib/images";

/**
 * Fond cinématique d'un panneau : vidéo (uniquement quand le panneau est ACTIF — une seule joue à la
 * fois) ou image statique, + color grade d'ère + vignette + grain + aura ki + letterbox.
 *
 * Exploitation correcte des MP4 :
 *  - une seule vidéo chargée/jouée à la fois (preload="none" + play()/pause() pilotés par `active`) ;
 *  - poster = frame extraite (affichage instantané, zéro flash noir) ;
 *  - reduced-motion / save-data / téléphone (≤640px) → image seule (pas de vidéo) — le décodage vidéo
 *    en continu (héro + panneaux) est le principal suspect des ralentissements/gestes ratés sur mobile ;
 *  - source = version web légère `.web.mp4` (720p/~2Mbps/faststart, servie par le VPS).
 */
export function SceneBackdrop({
	scene,
	active,
	priority = false,
	visible = true,
}: {
	scene: HomeScene;
	active: boolean;
	priority?: boolean;
	visible?: boolean;
}) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const [allowVideo, setAllowVideo] = useState(false);

	// Côté client uniquement : autoriser la vidéo sauf reduced-motion / économiseur de données /
	// téléphone (même seuil que le champ de clips flottants — cf. HomeClipField `isPhone`).
	useEffect(() => {
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
		const mq = window.matchMedia("(max-width: 640px)");
		const apply = () => setAllowVideo(!reduce && !conn?.saveData && !mq.matches);
		apply();
		mq.addEventListener("change", apply);
		return () => mq.removeEventListener("change", apply);
	}, []);

	const hasVideo = !!scene.video && allowVideo;
	const shouldPlay = hasVideo && active && visible;
	const videoSrc = scene.video ? assetUrl(scene.video.replace(/\.mp4$/i, ".web.mp4")) : "";
	const poster = scene.poster ? assetUrl(scene.poster) : assetUrl(scene.image);

	// Une seule vidéo active joue ; les autres se mettent en pause (et ne préchargent pas).
	useEffect(() => {
		const v = videoRef.current;
		if (!v) return;
		if (shouldPlay) {
			v.play().catch(() => {});
		} else {
			v.pause();
		}
	}, [shouldPlay]);

	return (
		<div
			aria-hidden
			data-active={active}
			className="scene-backdrop absolute inset-0 overflow-hidden"
			style={{
				// @ts-expect-error custom property
				"--accent": scene.accent,
				opacity: visible ? 1 : 0,
			}}
		>
			{hasVideo ? (
				<video
					ref={videoRef}
					src={videoSrc}
					poster={poster}
					loop
					muted
					playsInline
					preload={active ? "auto" : "none"}
					className={`scene-img object-cover object-center absolute inset-0 w-full h-full transition-all duration-1000 ${
						active ? "scale-105 opacity-95" : "scale-100 opacity-20"
					}`}
				/>
			) : (
				<Image
					src={assetUrl(scene.image)}
					alt=""
					fill
					priority={priority}
					sizes="100vw"
					quality={70}
					unoptimized={isEditableAsset(scene.image)}
					className={`scene-img object-cover object-[center_12%] ${
						active ? "scene-img--live" : ""
					}`}
				/>
			)}

			{/* Color grade d'ère — teinte l'image vers l'accent, fondu vers le noir */}
			<div className="scene-grade absolute inset-0" />
			{/* Lisibilité — dégradé bas concentré sous le contenu (laisse le clip net en
			    haut) + voile haut léger. Allégé vs avant → clips plus nets. */}
			{/* Voile de LISIBILITÉ, indépendant de la scène affichée.
			    Les fonds sont des images de l'anime : certaines sont très claires
			    (ciel de Namek, désert) et le texte blanc du héros passait alors sur
			    un bleu ciel — sous le seuil AA, sans qu'aucune configuration ne le
			    signale. Ce dégradé latéral assombrit le côté où vit le texte sans
			    écraser l'image, et se combine au dégradé vertical existant. */}
			<div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-dbz-bg/85 via-dbz-bg/45 to-dbz-bg/10" />
			<div className="absolute inset-0 bg-gradient-to-t from-dbz-bg via-dbz-bg/25 to-transparent" />
			<div className="absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-dbz-bg/55 to-transparent" />
			{/* Grain argentique discret (allégé pour ne pas ternir le clip) */}
			<div className="film-grain absolute inset-0 opacity-[0.09]" />
			{/* Letterbox cinéma */}
			<div className="scene-bar scene-bar--top" />
			<div className="scene-bar scene-bar--bottom" />
		</div>
	);
}
