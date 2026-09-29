"use client";

/**
 * Envoi d'images de l'éditeur. Le point d'entrée par défaut est le handler admin
 * (`/api/admin/upload`) qui vérifie la session, renifle les magic-bytes et relaie
 * au bot avec le jeton server-only. On renvoie le **chemin DB** (`./assets/…`) :
 * c'est lui qui doit atterrir dans le contenu, `assetUrl()` le résolvant à
 * l'affichage. Stocker une URL absolue figerait le domaine du CDN dans le texte.
 */
import { useCallback, useRef, useState } from "react";

export type UploadResult = { path: string };

export function useUploader(subdir: string, endpoint = "/api/admin/upload") {
	const [uploading, setUploading] = useState(false);
	const [progress, setProgress] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const inflight = useRef(0);

	const upload = useCallback(
		async (file: File): Promise<UploadResult | null> => {
			if (!file.type.startsWith("image/")) {
				setError("Ce fichier n'est pas une image.");
				return null;
			}
			inflight.current += 1;
			setUploading(true);
			setError(null);
			try {
				const body = new FormData();
				body.append("file", file, file.name);
				body.append("subdir", subdir);
				const res = await fetch(endpoint, { method: "POST", body, credentials: "same-origin" });
				const data = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
				if (!res.ok || !data.path) throw new Error(data.error ?? `Envoi échoué (${res.status}).`);
				return { path: data.path };
			} catch (e) {
				setError(e instanceof Error ? e.message : "Envoi échoué.");
				return null;
			} finally {
				inflight.current -= 1;
				if (inflight.current === 0) setUploading(false);
			}
		},
		[endpoint, subdir]
	);

	/** Envoie plusieurs fichiers en série (ordre d'insertion préservé). */
	const uploadAll = useCallback(
		async (files: File[]): Promise<string[]> => {
			const images = files.filter((f) => f.type.startsWith("image/"));
			const paths: string[] = [];
			for (const [i, file] of images.entries()) {
				setProgress(Math.round((i / images.length) * 100));
				const res = await upload(file);
				if (res) paths.push(res.path);
			}
			setProgress(0);
			return paths;
		},
		[upload]
	);

	return { upload, uploadAll, uploading, progress, error, clearError: () => setError(null) };
}
