"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { updateEpisodeMedia, uploadEpisodeSubtitle } from "./_actions";

type Track = { lang: string; label: string; src: string };

function SaveButton() {
	const { pending } = useFormStatus();
	return (
		<button
			type="submit"
			disabled={pending}
			className="inline-flex items-center h-9 px-5 rounded-full bg-dbz-orange hover:bg-white text-black font-display font-bold text-[13px] tracking-normal transition-colors disabled:opacity-50"
		>
			{pending ? "Enregistrement…" : "Enregistrer le média"}
		</button>
	);
}

/**
 * Éditeur média (vidéo + sous-titres) inline, réservé à l'admin, présent sur
 * chaque page d'épisode → permet d'attacher la source officielle et les pistes
 * de sous-titres à n'importe quel épisode. Écrit dans Neon via la server action
 * `updateEpisodeMedia` (aucun proxy bot).
 */
export function EpisodeMediaEditor({
	episodeId,
	videoUrl,
	subtitles,
}: {
	episodeId: number;
	videoUrl: string | null;
	subtitles: Track[] | null;
}) {
	const [tracks, setTracks] = useState<Track[]>(subtitles ?? []);
	const [uploadLang, setUploadLang] = useState("fr");
	const [uploadMsg, setUploadMsg] = useState<string | null>(null);
	const [uploading, setUploading] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

	const setTrack = (i: number, patch: Partial<Track>) =>
		setTracks((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
	const addTrack = () => setTracks((ts) => [...ts, { lang: "fr", label: "Français", src: "" }]);
	const removeTrack = (i: number) => setTracks((ts) => ts.filter((_, j) => j !== i));

	async function onUpload() {
		const file = fileRef.current?.files?.[0];
		if (!file) {
			setUploadMsg("Choisissez un fichier .vtt ou .srt.");
			return;
		}
		setUploading(true);
		setUploadMsg(null);
		const fd = new FormData();
		fd.append("file", file);
		fd.append("lang", uploadLang);
		const res = await uploadEpisodeSubtitle(episodeId, fd);
		setUploading(false);
		if ("error" in res) {
			setUploadMsg(res.error);
			return;
		}
		const label = uploadLang === "fr" ? "Français" : uploadLang === "en" ? "English" : uploadLang;
		setTracks((ts) => [
			...ts.filter((t) => t.src !== res.src),
			{ lang: uploadLang, label, src: res.src },
		]);
		setUploadMsg("Fichier importé — pensez à enregistrer.");
		if (fileRef.current) fileRef.current.value = "";
	}

	return (
		<details className="dbz-panel p-6 rounded-lg border border-dbz-border">
			<summary className="cursor-pointer font-display font-semibold text-[13px] tracking-[0.2em] uppercase text-dbz-orange select-none">
				Admin — Vidéo &amp; sous-titres
			</summary>

			<form action={updateEpisodeMedia.bind(null, episodeId)} className="mt-6 space-y-6">
				<input type="hidden" name="subtitles" value={JSON.stringify(tracks)} />

				<label className="block">
					<span className="block font-display text-[12px] uppercase tracking-widest text-white/50 mb-2">
						URL vidéo (lien officiel : ADN, Crunchyroll, YouTube officiel, HLS .m3u8…)
					</span>
					<input
						type="url"
						name="videoUrl"
						defaultValue={videoUrl ?? ""}
						placeholder="https://…"
						className="w-full rounded-md bg-black/40 border border-dbz-border px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-dbz-orange/60"
					/>
				</label>

				<div className="space-y-3">
					<div className="flex items-center justify-between">
						<span className="font-display text-[12px] uppercase tracking-widest text-white/50">
							Pistes de sous-titres (.vtt ou .srt)
						</span>
						<button
							type="button"
							onClick={addTrack}
							className="text-dbz-orange hover:text-white text-xs font-bold uppercase tracking-widest"
						>
							+ Ajouter
						</button>
					</div>

					{tracks.length === 0 && (
						<p className="text-white/50 text-sm">Aucune piste. « + Ajouter » pour en créer une.</p>
					)}

					{tracks.map((t, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: liste éditable ordonnée
						<div key={i} className="flex flex-wrap items-center gap-2">
							<input
								value={t.lang}
								onChange={(e) => setTrack(i, { lang: e.target.value })}
								aria-label={`Code langue de la piste ${i + 1}`}
								placeholder="lang (fr)"
								className="w-20 rounded-md bg-black/40 border border-dbz-border px-2 py-1.5 text-sm text-white"
							/>
							<input
								value={t.label}
								onChange={(e) => setTrack(i, { label: e.target.value })}
								aria-label={`Libellé de la piste ${i + 1}`}
								placeholder="Libellé (Français)"
								className="w-36 rounded-md bg-black/40 border border-dbz-border px-2 py-1.5 text-sm text-white"
							/>
							<input
								value={t.src}
								onChange={(e) => setTrack(i, { src: e.target.value })}
								aria-label={`Chemin du fichier de la piste ${i + 1}`}
								placeholder="assets/subtitles/db_episodes/<id>/fr.srt"
								className="flex-1 min-w-[220px] rounded-md bg-black/40 border border-dbz-border px-2 py-1.5 text-sm text-white"
							/>
							<button
								type="button"
								onClick={() => removeTrack(i)}
								className="text-dbz-red hover:text-white text-xs font-bold uppercase px-2"
							>
								Suppr.
							</button>
						</div>
					))}
				</div>

				<div className="rounded-md border border-dbz-border/60 bg-black/20 p-4 space-y-3">
					<span className="font-display text-[12px] uppercase tracking-widest text-white/50">
						Importer un fichier (.vtt / .srt)
					</span>
					<div className="flex flex-wrap items-center gap-2">
						<input
							value={uploadLang}
							onChange={(e) => setUploadLang(e.target.value.toLowerCase())}
							aria-label="Code langue du fichier à importer"
							placeholder="lang (fr)"
							className="w-20 rounded-md bg-black/40 border border-dbz-border px-2 py-1.5 text-sm text-white"
						/>
						<input
							ref={fileRef}
							type="file"
							aria-label="Fichier de sous-titres à importer (.vtt ou .srt)"
							accept=".vtt,.srt,text/vtt,application/x-subrip"
							className="flex-1 min-w-[200px] text-sm text-white/80 file:mr-3 file:rounded-full file:border-0 file:bg-dbz-border file:px-3 file:py-1.5 file:text-white"
						/>
						<button
							type="button"
							onClick={onUpload}
							disabled={uploading}
							className="inline-flex items-center h-8 px-4 rounded-full border border-dbz-orange/50 text-dbz-orange hover:bg-dbz-orange hover:text-black text-xs font-bold uppercase tracking-widest transition-colors disabled:opacity-50"
						>
							{uploading ? "Import…" : "Importer"}
						</button>
					</div>
					{uploadMsg && <p className="text-xs text-white/60">{uploadMsg}</p>}
				</div>

				<SaveButton />
			</form>
		</details>
	);
}
