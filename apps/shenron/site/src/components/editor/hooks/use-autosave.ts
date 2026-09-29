"use client";

/**
 * Autosauvegarde à deux étages : **copie locale immédiate** (instantanée, hors
 * ligne, survit au crash de l'onglet) et **brouillon serveur** anti-rebond
 * (`/api/editor/draft`, retrouvable depuis un autre appareil).
 *
 * Le contrat, c'est celui d'un traitement de texte moderne : on ne perd jamais
 * ce qui a été tapé. L'état renvoyé (`status`) alimente la pastille « Modifié /
 * Enregistrement… / Enregistré » de la barre d'état.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export type RecoveredDraft = {
	content: string;
	savedAt: Date;
	origin: "local" | "serveur";
};

const LOCAL_PREFIX = "shenron-editor-draft:";
/** Délai de stabilisation de la frappe avant d'écrire au serveur. */
const REMOTE_DEBOUNCE_MS = 2500;

function localKey(key: string) {
	return `${LOCAL_PREFIX}${key}`;
}

export function useAutosave({
	key,
	format,
	enabled = true,
	label,
}: {
	key?: string;
	format: "doc" | "markdown" | "text";
	enabled?: boolean;
	label?: string;
}) {
	const [status, setStatus] = useState<SaveStatus>("idle");
	const [savedAt, setSavedAt] = useState<Date | null>(null);
	const [recovered, setRecovered] = useState<RecoveredDraft | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pending = useRef<string | null>(null);
	const active = Boolean(enabled && key);

	/* ---- Reprise : un brouillon plus récent existe-t-il ? ------------------ */
	useEffect(() => {
		if (!active || !key) return;
		let cancelled = false;

		// Local d'abord (immédiat), serveur ensuite (plus fiable entre appareils).
		try {
			const raw = localStorage.getItem(localKey(key));
			if (raw) {
				const parsed = JSON.parse(raw) as { content: string; at: number };
				if (parsed?.content) {
					setRecovered({ content: parsed.content, savedAt: new Date(parsed.at), origin: "local" });
				}
			}
		} catch {
			// Stockage local indisponible (navigation privée) : on continue sans.
		}

		void (async () => {
			try {
				const res = await fetch(`/api/editor/draft?key=${encodeURIComponent(key)}`, {
					credentials: "same-origin",
				});
				if (!res.ok || cancelled) return;
				const data = (await res.json()) as {
					draft: { content: string; updatedAt: string } | null;
				};
				if (!data.draft || cancelled) return;
				const at = new Date(data.draft.updatedAt);
				setRecovered((prev) =>
					prev && prev.savedAt >= at
						? prev
						: { content: data.draft!.content, savedAt: at, origin: "serveur" }
				);
			} catch {
				// Hors ligne : la copie locale fait le travail.
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [active, key]);

	/* ---- Écriture --------------------------------------------------------- */
	const flush = useCallback(async () => {
		if (!active || !key || pending.current === null) return;
		const content = pending.current;
		pending.current = null;
		setStatus("saving");
		try {
			const res = await fetch("/api/editor/draft", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				credentials: "same-origin",
				body: JSON.stringify({ key, format, content, label }),
			});
			if (!res.ok) throw new Error(String(res.status));
			setStatus("saved");
			setSavedAt(new Date());
		} catch {
			// Le serveur n'a pas voulu : la copie locale reste le filet.
			setStatus("error");
		}
	}, [active, format, key, label]);

	const schedule = useCallback(
		(content: string) => {
			if (!active || !key) return;
			// 1. copie locale, tout de suite
			try {
				localStorage.setItem(localKey(key), JSON.stringify({ content, at: Date.now() }));
			} catch {
				// Quota plein ou navigation privée : on n'a plus que le serveur.
			}
			// 2. serveur, une fois la frappe stabilisée
			pending.current = content;
			setStatus("dirty");
			if (timer.current) clearTimeout(timer.current);
			timer.current = setTimeout(() => void flush(), REMOTE_DEBOUNCE_MS);
		},
		[active, flush, key]
	);

	/** Le contenu a été enregistré à sa vraie place : le brouillon n'a plus lieu d'être. */
	const clear = useCallback(async () => {
		if (!key) return;
		if (timer.current) clearTimeout(timer.current);
		pending.current = null;
		setRecovered(null);
		setStatus("saved");
		setSavedAt(new Date());
		try {
			localStorage.removeItem(localKey(key));
		} catch {
			// sans importance
		}
		if (!active) return;
		try {
			await fetch(`/api/editor/draft?key=${encodeURIComponent(key)}`, {
				method: "DELETE",
				credentials: "same-origin",
			});
		} catch {
			// Le brouillon serveur périmé sera écrasé à la prochaine édition.
		}
	}, [active, key]);

	// Dernière chance : l'onglet se ferme, on pousse ce qui reste en attente.
	useEffect(() => {
		if (!active) return;
		const onHide = () => {
			if (pending.current !== null && key) {
				const blob = new Blob([JSON.stringify({ key, format, content: pending.current, label })], {
					type: "application/json",
				});
				// `sendBeacon` survit au déchargement de la page, contrairement à fetch.
				navigator.sendBeacon?.("/api/editor/draft", blob);
			}
		};
		document.addEventListener("visibilitychange", onHide);
		window.addEventListener("pagehide", onHide);
		return () => {
			document.removeEventListener("visibilitychange", onHide);
			window.removeEventListener("pagehide", onHide);
		};
	}, [active, format, key, label]);

	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[]
	);

	return {
		status,
		savedAt,
		recovered,
		dismissRecovered: () => setRecovered(null),
		schedule,
		flush,
		clear,
	};
}
