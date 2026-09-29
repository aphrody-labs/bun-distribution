"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Coeur } from "@/components/icones";
import { assetUrl } from "@/lib/assets";
import { useMe } from "@/lib/use-me";
import {
	FAVORITES_EVENT,
	readFavorites,
	syncFavorites,
	toggleFavorite,
	type Favorite,
} from "@/lib/favorites";

const KIND_LABEL: Record<Favorite["kind"], string> = {
	episode: "Épisode",
	movie: "Film",
	chapter: "Chapitre",
	databook: "Databook",
	character: "Personnage",
	saga: "Saga",
	game: "Jeu",
};

export function FavoritesList() {
	const me = useMe();
	// `null` = pas encore lu. Distingué de « lu, et vide » pour ne pas faire
	// clignoter l'état vide avant l'hydratation.
	const [items, setItems] = useState<Favorite[] | null>(null);

	useEffect(() => {
		const refresh = () => setItems(readFavorites());
		refresh();
		window.addEventListener(FAVORITES_EVENT, refresh);
		return () => window.removeEventListener(FAVORITES_EVENT, refresh);
	}, []);

	useEffect(() => {
		if (me?.authenticated) void syncFavorites();
	}, [me?.authenticated]);

	if (items === null) {
		return (
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{Array.from({ length: 6 }).map((_, i) => (
					<div key={i} className="h-32 animate-pulse rounded-xl bg-dbz-card" />
				))}
			</div>
		);
	}

	if (items.length === 0) {
		return (
			<div className="rounded-xl border border-white/[0.08] bg-dbz-card/50 px-6 py-16 text-center">
				<Coeur className="mx-auto h-8 w-8 text-white/50" aria-hidden />
				<p className="mt-4 text-white/70">Aucun favori pour l&apos;instant.</p>
				<p className="mt-2 text-[14px] text-white/50">
					Le cœur présent sur les fiches d&apos;épisode, de film et de chapitre les range ici.
				</p>
				<div className="mt-8 flex flex-wrap items-center justify-center gap-3">
					<Link href="/wiki/episodes" className="dbz-button !text-xs">
						Parcourir les épisodes
					</Link>
					<Link href="/wiki/hasard" className="dbz-button-ghost !text-xs">
						Une fiche au hasard
					</Link>
				</div>
			</div>
		);
	}

	return (
		<>
			<p className="mb-4 text-[13px] text-white/50">
				{items.length} favori{items.length > 1 ? "s" : ""}
				{me?.authenticated ? " · synchronisés avec ton compte" : " · sur cet appareil"}
			</p>
			<ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{items.map((f) => (
					<li
						key={`${f.kind}:${f.id}`}
						className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-dbz-card transition-colors hover:border-dbz-orange/40"
					>
						<Link href={f.href} className="flex gap-3">
							<div className="relative h-24 w-40 shrink-0 overflow-hidden bg-black/40">
								{f.image ? (
									<img
										src={assetUrl(f.image)}
										alt=""
										loading="lazy"
										className="h-full w-full object-cover opacity-90"
									/>
								) : (
									<div className="grid h-full w-full place-items-center text-[11px] uppercase tracking-widest text-white/50">
										{KIND_LABEL[f.kind]}
									</div>
								)}
							</div>
							<div className="min-w-0 flex-1 py-3 pr-10">
								<p className="truncate text-[14px] font-semibold text-white">{f.title}</p>
								<p className="mt-1 truncate text-[12px] text-white/50">
									{f.caption ?? KIND_LABEL[f.kind]}
								</p>
							</div>
						</Link>
						<button
							type="button"
							onClick={() =>
								toggleFavorite({
									kind: f.kind,
									id: f.id,
									title: f.title,
									href: f.href,
									image: f.image,
									caption: f.caption,
								})
							}
							aria-label={`Retirer « ${f.title} » des favoris`}
							// 32 px au dessin : `.cible-44` étend la zone tactile à 44 px
							// par pseudo-élément, sans grossir le cœur ni bouger la carte.
							className="cible-44 absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full text-dbz-orange transition-colors hover:bg-white/[0.08]"
						>
							<Coeur className="h-4 w-4" aria-hidden fill="currentColor" />
						</button>
					</li>
				))}
			</ul>
		</>
	);
}
