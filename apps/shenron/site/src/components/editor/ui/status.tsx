"use client";

/**
 * Barre d'état : compteurs, temps de lecture, et surtout **l'état de
 * sauvegarde**. Un rédacteur doit pouvoir répondre d'un coup d'œil à « est-ce
 * que mon texte est en sécurité ? » — c'est la moitié du confort d'un
 * traitement de texte moderne.
 */
import { Check, CloudOff, Loader2, TriangleAlert } from "lucide-react";

import type { SaveStatus } from "../hooks/use-autosave";
import { cn } from "@/lib/utils";

/** Vitesse de lecture retenue : 220 mots/minute (lecture d'écran en français). */
const WORDS_PER_MINUTE = 220;

export function StatusBar({
	words,
	characters,
	status,
	savedAt,
	warning,
	right,
}: {
	words: number;
	characters: number;
	status: SaveStatus;
	savedAt: Date | null;
	warning?: string | null;
	right?: React.ReactNode;
}) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-white/10 bg-[#141416] px-3 py-2 text-[11px]">
			<span className="tabular-nums text-white/50">
				{words} mot{words > 1 ? "s" : ""} · {characters} signes ·{" "}
				{Math.max(1, Math.round(words / WORDS_PER_MINUTE))} min de lecture
			</span>
			<span className="flex items-center gap-3">
				{warning && (
					<span className="flex items-center gap-1.5 text-amber-300" role="status">
						<TriangleAlert className="size-3.5 shrink-0" />
						{warning}
					</span>
				)}
				<SaveIndicator status={status} savedAt={savedAt} />
				{right}
			</span>
		</div>
	);
}

function SaveIndicator({ status, savedAt }: { status: SaveStatus; savedAt: Date | null }) {
	if (status === "idle") return null;
	const time = savedAt
		? savedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
		: null;

	const map: Record<
		Exclude<SaveStatus, "idle">,
		{ icon: React.ReactNode; text: string; tone: string }
	> = {
		dirty: { icon: null, text: "Modifications non enregistrées", tone: "text-white/45" },
		saving: {
			icon: <Loader2 className="size-3.5 animate-spin" />,
			text: "Enregistrement…",
			tone: "text-white/60",
		},
		saved: {
			icon: <Check className="size-3.5" />,
			text: time ? `Brouillon enregistré à ${time}` : "Brouillon enregistré",
			tone: "text-emerald-400/80",
		},
		error: {
			icon: <CloudOff className="size-3.5" />,
			text: "Serveur injoignable — copie locale conservée",
			tone: "text-amber-300",
		},
	};

	const item = map[status];
	return (
		<span className={cn("flex items-center gap-1.5", item.tone)} aria-live="polite">
			{item.icon}
			{item.text}
		</span>
	);
}

/** Bandeau de reprise d'un brouillon plus récent que le contenu chargé. */
export function RecoveryBanner({
	savedAt,
	origin,
	onRestore,
	onDismiss,
}: {
	savedAt: Date;
	origin: "local" | "serveur";
	onRestore: () => void;
	onDismiss: () => void;
}) {
	return (
		<div className="flex flex-wrap items-center gap-3 border-b border-amber-400/25 bg-amber-400/10 px-4 py-2.5 text-[13px] text-amber-100">
			<TriangleAlert className="size-4 shrink-0" aria-hidden />
			<span className="min-w-0 flex-1">
				Un brouillon {origin === "local" ? "local" : "enregistré"} du{" "}
				{savedAt.toLocaleString("fr-FR", {
					day: "2-digit",
					month: "2-digit",
					hour: "2-digit",
					minute: "2-digit",
				})}{" "}
				est plus récent que ce contenu.
			</span>
			<button
				type="button"
				onClick={onRestore}
				className="rounded-lg bg-amber-400 px-3 py-1.5 text-[12px] font-semibold text-black hover:bg-amber-300"
			>
				Reprendre le brouillon
			</button>
			<button
				type="button"
				onClick={onDismiss}
				className="rounded-lg px-2 py-1.5 text-[12px] font-medium text-amber-100/70 hover:text-amber-50"
			>
				Ignorer
			</button>
		</div>
	);
}
