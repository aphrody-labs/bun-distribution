"use client";

/**
 * EpisodeScenes — Section « Scènes & Frame Finder (bxc frames) » d'un épisode.
 *
 * Combine deux moteurs :
 *   1. Galerie des scènes de l'épisode (`EpisodeFrame[]`) + export GIF animé (`encodeFramesToGif`).
 *   2. Scanner & Identifier de frames `bxc frames` (MPEG-7 ColorLayout DCT + trace.moe)
 *      permettant d'analyser n'importe quelle capture d'écran, de vérifier le timecode
 *      d'une scène et d'extraire la signature visuelle compacte de 33 coefficients.
 *
 * Affiché sur TOUS les épisodes du site pour offrir la feature frames de bxc en direct.
 */

import { useCallback, useMemo, useState } from "react";
import { assetUrl } from "@/lib/assets";
import { Film, RefreshCw, Scan, Search, Sparkles, Upload } from "lucide-react";

/**
 * Réplique client-safe de `EpisodeFrame` (cf. `@/db/bot-schema`).
 */
export type SceneFrame = {
	source: "ffmpeg";
	sourceId: string;
	sourceUrl: string | null;
	episodeNumber: number;
	imagePath: string | null;
	timecodeSec: number | null;
	width: number | null;
	height: number | null;
	characterNames: string[];
	tags: string[];
	caption: string | null;
	isNotable: boolean;
	sortOrder: number;
};

interface FrameSearchResult {
	title: string;
	episode: number | null;
	season: number | null;
	atMs: number;
	timecode: string;
	similarity: number;
	isFirm: boolean;
	isPlausible: boolean;
	/** Faux = correspondance hors univers Dragon Ball (bruit trace.moe). */
	isDragonBall: boolean;
	/** Fiche du site visée, `null` si la correspondance ne concerne pas le site. */
	siteEpisode: {
		id: number;
		series: string;
		numberInSeries: number | null;
		title: string | null;
		href: string;
	} | null;
	preview: {
		image: string;
		video: string;
	};
	source: string;
	anilist: number;
}

interface BxcApiResponse {
	success: boolean;
	hash: string | null;
	/** Moteur qui a répondu : index local de la machine, trace.moe, ou rien. */
	origin?: "local" | "trace.moe" | "none";
	/** Vrai quand AUCUNE correspondance ne concerne Dragon Ball. */
	offUniverseOnly?: boolean;
	vector: number[];
	matches: FrameSearchResult[];
	quota: {
		used: number;
		total: number;
	};
}

function formatTimecode(sec: number | null): string | null {
	if (sec == null || !Number.isFinite(sec)) return null;
	const s = Math.max(0, Math.floor(sec));
	const m = Math.floor(s / 60);
	const r = s % 60;
	return `${m}:${String(r).padStart(2, "0")}`;
}

/** Charge une image cross-origin en canvas pour l'encodage GIF. */
function loadFrameCanvas(src: string, width: number, height: number): Promise<HTMLCanvasElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.decoding = "async";
		img.onload = () => {
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext("2d");
			if (!ctx) {
				reject(new Error("Canvas 2D indisponible"));
				return;
			}
			const ir = img.width / img.height;
			const cr = width / height;
			let sx = 0;
			let sy = 0;
			let sw = img.width;
			let sh = img.height;
			if (ir > cr) {
				sw = img.height * cr;
				sx = (img.width - sw) / 2;
			} else {
				sh = img.width / cr;
				sy = (img.height - sh) / 2;
			}
			ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
			resolve(canvas);
		};
		img.onerror = () => reject(new Error(`Frame illisible : ${src}`));
		img.src = src;
	});
}

export function EpisodeScenes({
	frames = [],
	title,
	episodeNumber,
	series,
	episodeId,
	episodeImage,
}: {
	frames?: SceneFrame[];
	title: string;
	episodeNumber: number;
	series?: string;
	episodeId?: number;
	episodeImage?: string | null;
}) {
	const renderable = useMemo(
		() =>
			(frames ?? [])
				.filter((f): f is SceneFrame & { imagePath: string } => f.imagePath != null)
				.toSorted((a, b) => a.sortOrder - b.sortOrder),
		[frames]
	);

	// Onglet actif : "scenes" (si frames présentes) ou "finder"
	const [activeTab, setActiveTab] = useState<"scenes" | "finder">(
		renderable.length > 0 ? "scenes" : "finder"
	);

	// État de sélection pour l'export GIF
	const [selected, setSelected] = useState<Set<number>>(() => new Set());
	const [busyGif, setBusyGif] = useState(false);
	const [errorGif, setErrorGif] = useState<string | null>(null);
	const [gifUrl, setGifUrl] = useState<string | null>(null);

	// État du scanner / analyseur bxc frames
	const [searchUrl, setSearchUrl] = useState<string>("");
	const [uploadedFile, setUploadedFile] = useState<File | null>(null);
	const [scanning, setScanning] = useState(false);
	const [scanError, setScanError] = useState<string | null>(null);
	const [scanResults, setScanResults] = useState<BxcApiResponse | null>(null);

	const selectionMode = selected.size > 0;

	const toggle = useCallback((idx: number) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(idx)) next.delete(idx);
			else next.add(idx);
			return next;
		});
	}, []);

	const orderedSelection = useMemo(() => [...selected].toSorted((a, b) => a - b), [selected]);

	const exportGif = useCallback(async () => {
		setBusyGif(true);
		setErrorGif(null);
		try {
			const width = 480;
			const height = 270;
			const canvases = await Promise.all(
				orderedSelection.map((i) =>
					loadFrameCanvas(assetUrl(renderable[i].imagePath), width, height)
				)
			);
			const { encodeFramesToGif } = await import("@/components/media/encodeGif");
			const blob = await encodeFramesToGif({
				width,
				height,
				frames: canvases.map((c) => ({ data: c, delay: 400 })),
				dither: "floyd-steinberg",
			});
			setGifUrl((prev) => {
				if (prev) URL.revokeObjectURL(prev);
				return URL.createObjectURL(blob);
			});
		} catch (e) {
			setErrorGif(e instanceof Error ? e.message : String(e));
		} finally {
			setBusyGif(false);
		}
	}, [orderedSelection, renderable]);

	const clearSelection = useCallback(() => {
		setSelected(new Set());
		setGifUrl((prev) => {
			if (prev) URL.revokeObjectURL(prev);
			return null;
		});
		setErrorGif(null);
	}, []);

	// Lancement de l'analyse bxc frames
	const executeScan = async (overrideTarget?: { file?: File; url?: string }) => {
		setScanning(true);
		setScanError(null);
		setScanResults(null);

		try {
			const formData = new FormData();
			const targetFile = overrideTarget?.file ?? uploadedFile;
			const targetUrl = overrideTarget?.url ?? searchUrl;

			if (targetFile) {
				formData.append("file", targetFile);
			} else if (targetUrl?.trim()) {
				formData.append("url", targetUrl.trim());
			} else {
				throw new Error("Veuillez choisir un fichier ou renseigner une URL d'image.");
			}

			const res = await fetch("/api/frames/search", {
				method: "POST",
				body: formData,
			});

			const data = (await res.json()) as BxcApiResponse & { error?: string };
			if (!res.ok || data.error) {
				throw new Error(data.error || `Erreur serveur (${res.status})`);
			}

			setScanResults(data);
		} catch (err) {
			setScanError(err instanceof Error ? err.message : "Erreur lors de l'analyse.");
		} finally {
			setScanning(false);
		}
	};

	return (
		<section className="space-y-6 reveal-up">
			{/* En-tête de section avec navigation par onglets */}
			<div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
				<div className="flex items-center gap-3">
					<div className="grid h-8 w-8 place-items-center rounded-lg bg-dbz-orange/20 text-dbz-orange border border-dbz-orange/40">
						<Film className="h-4 w-4" />
					</div>
					<div>
						<h2 className="font-display font-bold text-2xl text-white uppercase tracking-wider flex items-center gap-2">
							Scènes &amp; Frames
							<span className="rounded bg-gradient-to-r from-amber-500 to-dbz-orange px-2 py-0.5 text-[9px] font-mono font-black uppercase tracking-widest text-black">
								bxc frames
							</span>
						</h2>
						<p className="text-[12px] text-white/50">
							Extraction vidéo, analyse MPEG-7 ColorLayout et identification de scènes.
						</p>
					</div>
				</div>

				<div className="flex items-center gap-2 rounded-lg bg-black/40 p-1 border border-white/10">
					{renderable.length > 0 && (
						<button
							type="button"
							onClick={() => setActiveTab("scenes")}
							className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
								activeTab === "scenes"
									? "bg-dbz-orange text-black font-bold shadow-sm"
									: "text-white/60 hover:text-white"
							}`}
						>
							<Film className="h-3.5 w-3.5" />
							Scènes ({renderable.length})
						</button>
					)}
					<button
						type="button"
						onClick={() => setActiveTab("finder")}
						className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
							activeTab === "finder"
								? "bg-dbz-orange text-black font-bold shadow-sm"
								: "text-white/60 hover:text-white"
						}`}
					>
						<Scan className="h-3.5 w-3.5" />
						Frame Finder (bxc)
					</button>
				</div>
			</div>

			{/* Onglet 1 : Galerie de Scènes */}
			{activeTab === "scenes" && renderable.length > 0 && (
				<div className="space-y-4">
					<div className="flex items-center justify-between text-xs text-white/60">
						<p>Sélectionnez plusieurs frames pour créer un GIF animé instantané.</p>
						<span className="scouter-text text-dbz-orange">
							{renderable.length} frame{renderable.length > 1 ? "s" : ""} indexée(s)
						</span>
					</div>

					<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
						{renderable.map((f, i) => {
							const isSelected = selected.has(i);
							const order = isSelected ? orderedSelection.indexOf(i) + 1 : 0;
							const tc = formatTimecode(f.timecodeSec);
							const alt =
								f.caption ??
								(f.characterNames.length > 0
									? `Scène avec ${f.characterNames.join(", ")}`
									: `Scène de l'épisode ${episodeNumber}`);
							return (
								<button
									key={`${f.imagePath}-${i}`}
									type="button"
									onClick={() => toggle(i)}
									aria-pressed={isSelected}
									className={`group relative aspect-video overflow-hidden rounded-lg bg-dbz-bg text-left transition-all dbz-panel ${
										isSelected
											? "ring-2 ring-dbz-orange"
											: f.isNotable
												? "ring-1 ring-dbz-orange/40"
												: ""
									}`}
								>
									<img
										src={assetUrl(f.imagePath)}
										alt={alt}
										loading="lazy"
										decoding="async"
										className="h-full w-full object-cover opacity-85 transition-all duration-500 group-hover:opacity-100 group-hover:scale-105"
									/>
									<div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

									{f.isNotable && (
										<span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-full bg-dbz-orange/85 text-black text-[9px] font-bold uppercase tracking-widest">
											★ Marquante
										</span>
									)}

									{tc && (
										<span className="absolute top-1.5 right-1.5 scouter-text text-[9px] text-dbz-orange bg-black/60 px-1.5 py-0.5 rounded">
											{tc}
										</span>
									)}

									{(f.caption ?? f.characterNames.length > 0) && (
										<div className="absolute bottom-1.5 left-1.5 right-1.5 flex flex-wrap gap-1">
											{f.caption ? (
												<span className="px-1.5 py-0.5 rounded-full bg-black/65 backdrop-blur-sm text-white text-[9px] font-semibold leading-none line-clamp-1">
													{f.caption}
												</span>
											) : (
												f.characterNames.slice(0, 3).map((name) => (
													<span
														key={name}
														className="px-1.5 py-0.5 rounded-full bg-black/65 backdrop-blur-sm text-white text-[9px] font-semibold leading-none line-clamp-1"
													>
														{name}
													</span>
												))
											)}
										</div>
									)}

									{order > 0 && (
										<span className="absolute bottom-1.5 right-1.5 grid h-6 w-6 place-items-center rounded-full bg-dbz-orange text-black text-[11px] font-bold">
											{order}
										</span>
									)}
								</button>
							);
						})}
					</div>

					{/* Barre d'export GIF */}
					{selectionMode && (
						<div className="flex flex-wrap items-center gap-4 dbz-panel p-4 mt-4">
							<span className="text-sm text-white/70">
								{selected.size} frame{selected.size > 1 ? "s" : ""} sélectionnée(s)
							</span>
							<button
								type="button"
								onClick={exportGif}
								disabled={busyGif}
								className="rounded-lg bg-dbz-orange px-4 py-2 font-display font-semibold text-black text-sm transition-opacity disabled:opacity-50"
							>
								{busyGif ? "Encodage…" : "Exporter en GIF"}
							</button>
							<button
								type="button"
								onClick={clearSelection}
								className="text-sm text-white/50 hover:text-white transition-colors underline"
							>
								Effacer
							</button>
							{errorGif && <span className="text-sm text-dbz-red">{errorGif}</span>}
							{gifUrl && (
								<figure className="flex items-center gap-3">
									<img
										src={gifUrl}
										alt={`GIF de scènes — ${title}`}
										width={160}
										height={90}
										className="rounded-md border border-white/10"
									/>
									<a
										href={gifUrl}
										download={`dbfr-ep${String(episodeNumber).padStart(3, "0")}-scenes.gif`}
										className="text-sm text-dbz-orange underline"
									>
										Télécharger le GIF
									</a>
								</figure>
							)}
						</div>
					)}
				</div>
			)}

			{/* Onglet 2 : Frame Finder & Reconnaissance bxc frames */}
			{activeTab === "finder" && (
				<div className="space-y-6">
					<div className="rounded-xl border border-dbz-orange/30 bg-black/40 p-6 backdrop-blur">
						<div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
							<div>
								<h3 className="text-lg font-bold text-white flex items-center gap-2">
									<Sparkles className="h-4 w-4 text-dbz-yellow" />
									Recherche &amp; Identification de Scène
								</h3>
								<p className="text-xs text-white/60 mt-1 max-w-2xl">
									Soumettez une capture d&apos;écran ou analysez la vignette officielle de l&apos;épisode.
									Le moteur <code>bxc frames</code> calcule le vecteur ColorLayout MPEG-7
									et interroge la base neuronale pour retrouver l&apos;épisode et le timecode exacts.
								</p>
							</div>

							{episodeImage && (
								<button
									type="button"
									disabled={scanning}
									onClick={() => executeScan({ url: assetUrl(episodeImage) })}
									className="shrink-0 inline-flex items-center gap-2 rounded-lg border border-dbz-orange/60 bg-dbz-orange/15 px-3.5 py-2 text-xs font-bold text-dbz-yellow transition-all hover:bg-dbz-orange hover:text-black focus:outline-none disabled:opacity-50"
								>
									{scanning ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
									Scanner la vignette de cet épisode
								</button>
							)}
						</div>

						{/* Formulaire de soumission d'image */}
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="space-y-2">
								<label className="text-xs font-semibold text-white/70 block">
									URL d&apos;une image ou capture
								</label>
								<div className="flex gap-2">
									<input
										type="url"
										aria-label="URL de l'image ou capture d'écran"
										placeholder="https://..."
										value={searchUrl}
										onChange={(e) => setSearchUrl(e.target.value)}
										className="flex-1 rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-xs text-white placeholder-white/30 focus:border-dbz-orange focus:outline-none"
									/>
									<button
										type="button"
										disabled={scanning || !searchUrl.trim()}
										onClick={() => executeScan()}
										className="rounded-lg bg-dbz-orange px-4 py-2 text-xs font-bold text-black transition-opacity disabled:opacity-50"
									>
										{scanning ? "Analyse…" : "Analyser"}
									</button>
								</div>
							</div>

							<div className="space-y-2">
								<label className="text-xs font-semibold text-white/70 block">
									Ou téléverser un fichier local
								</label>
								<label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 bg-black/30 p-2 text-xs text-white/60 hover:border-dbz-orange/50 hover:text-white cursor-pointer transition-colors">
									<Upload className="h-3.5 w-3.5" />
									<span>{uploadedFile ? uploadedFile.name : "Glisser une capture (PNG, JPG, WebP)"}</span>
									<input
										type="file"
										aria-label="Sélectionner un fichier image de capture"
										accept="image/*"
										className="hidden"
										onChange={(e) => {
											const file = e.target.files?.[0];
											if (file) {
												setUploadedFile(file);
												executeScan({ file });
											}
										}}
									/>
								</label>
							</div>
						</div>

						{scanError && (
							<div className="mt-4 rounded-lg bg-red-950/40 border border-red-500/40 p-3 text-xs text-red-300">
								{scanError}
							</div>
						)}
					</div>

					{/* Résultats de l'analyse bxc frames */}
					{scanResults && (
						<div className="rounded-xl border border-white/10 bg-black/60 p-6 space-y-6">
							<div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
								<div>
									<h4 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
										Résultats d&apos;analyse de scène
										<span className="text-xs font-mono text-dbz-orange">
											({scanResults.matches.length} correspondance(s))
										</span>
									</h4>
									{scanResults.hash && (
										<p className="text-[11px] font-mono text-white/40 mt-1">
											Signature ColorLayout MPEG-7 : <code>{scanResults.hash}</code>
										</p>
									)}
									{scanResults.origin && scanResults.origin !== "none" && (
										<p className="mt-1 text-[11px] text-white/50">
											Source :{" "}
											{scanResults.origin === "local" ? (
												<strong className="text-emerald-400">
													index local des épisodes (frame par frame)
												</strong>
											) : (
												<strong className="text-yellow-400">
													trace.moe — catalogue anime mondial, hors base DBFR
												</strong>
											)}
										</p>
									)}
								</div>

								{scanResults.vector.length > 0 && (
									<div className="flex items-center gap-1 bg-black/40 px-3 py-1.5 rounded-lg border border-white/10">
										<span className="text-[10px] text-white/50 mr-2 font-mono">DCT 33 Coeffs</span>
										<div className="flex items-end gap-0.5 h-4">
											{scanResults.vector.slice(0, 24).map((val, idx) => {
												const h = Math.min(100, Math.max(15, (val / 64) * 100));
												return (
													<div
														key={idx}
														style={{ height: `${h}%` }}
														className={`w-1 rounded-t-sm ${
															idx < 8
																? "bg-dbz-orange"
																: idx < 16
																	? "bg-dbz-yellow"
																	: "bg-blue-400"
														}`}
														title={`Coeff ${idx}: ${val}`}
													/>
												);
											})}
										</div>
									</div>
								)}
							</div>

							{scanResults.offUniverseOnly && scanResults.matches.length > 0 && (
								<div className="rounded-lg border border-yellow-500/40 bg-yellow-950/20 p-3 text-xs text-yellow-200">
									Aucune de ces correspondances n&apos;appartient à Dragon Ball : trace.moe a
									rapproché la signature d&apos;autres anime. L&apos;index local frame par frame
									des épisodes DBFR n&apos;est pas encore constitué — jusque-là, ces résultats
									sont indicatifs et ne valent pas identification.
								</div>
							)}

							{scanResults.matches.length === 0 ? (
								<p className="text-xs text-white/50 italic py-4 text-center">
									Aucune correspondance formelle trouvée pour cette image dans le catalogue Toei/Toriyama.
								</p>
							) : (
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									{scanResults.matches.map((m, idx) => {
										// Un numéro d'épisode seul ne prouve rien : « One Piece 5 » et
										// « DB 5 » partagent le même entier. La confirmation exige que la
										// correspondance soit rattachée à CETTE fiche du site.
										const isCurrentEp =
											m.isDragonBall &&
											(m.siteEpisode?.id === episodeId ||
												(m.siteEpisode?.numberInSeries === episodeNumber &&
													m.siteEpisode?.series === series));
										return (
											<div
												key={idx}
												className={`rounded-lg border p-4 transition-all ${
													isCurrentEp
														? "border-emerald-500/50 bg-emerald-950/20"
														: m.isFirm
															? "border-dbz-orange/40 bg-black/40"
															: "border-white/10 bg-black/30"
												}`}
											>
												<div className="flex gap-3">
													{m.preview?.video ? (
														<div className="relative w-36 aspect-video shrink-0 overflow-hidden rounded bg-black">
															<video
																src={m.preview.video}
																autoPlay
																muted
																loop
																playsInline
																className="h-full w-full object-cover"
															/>
														</div>
													) : m.preview?.image ? (
														<img
															src={m.preview.image}
															alt={m.title}
															className="w-36 aspect-video shrink-0 rounded object-cover border border-white/10"
														/>
													) : null}

													<div className="min-w-0 flex-1 space-y-1">
														<div className="flex items-center justify-between gap-2">
															<p className="font-bold text-xs text-white truncate">{m.title}</p>
															<span
																className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
																	m.isFirm
																		? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
																		: m.isPlausible
																			? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
																			: "bg-white/10 text-white/50"
																}`}
															>
																{m.similarity}%
															</span>
														</div>

														<div className="flex items-center gap-2 text-xs text-white/70">
															<span>
																Épisode <strong>{m.episode ?? "?"}</strong>
															</span>
															<span>•</span>
															<span className="font-mono text-dbz-orange font-bold">
																{m.timecode}
															</span>
														</div>

														{m.siteEpisode && (
															<a
																href={m.siteEpisode.href}
																className="inline-flex items-center gap-1 text-[10px] font-bold text-dbz-orange underline-offset-2 hover:underline"
															>
																Ouvrir la fiche{" "}
																{m.siteEpisode.title
																	? `« ${m.siteEpisode.title} »`
																	: `#${m.siteEpisode.id}`}{" "}
																au timecode
															</a>
														)}

														{!m.isDragonBall && (
															<div className="inline-flex items-center gap-1 rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-bold text-yellow-300">
																Hors univers Dragon Ball
															</div>
														)}

														{isCurrentEp && (
															<div className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30 mt-1">
																✓ Confirmé pour cet épisode !
															</div>
														)}
													</div>
												</div>
											</div>
										);
									})}
								</div>
							)}
						</div>
					)}
				</div>
			)}
		</section>
	);
}
