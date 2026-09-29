"use client";

/**
 * Menu « / » — la façon la plus rapide d'insérer un bloc sans quitter le clavier.
 *
 * Le plugin de suggestion ne rend rien lui-même : il remonte son état à React,
 * qui affiche la liste. Un seul arbre React, donc pas de second point de montage
 * à synchroniser, et le menu hérite naturellement du thème et de l'a11y du reste
 * du module.
 */
import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { GROUP_LABEL, matchAction, type EditorAction, type EditorDialogs } from "../commands";
import { cn } from "@/lib/utils";

export type SlashState = {
	items: EditorAction[];
	rect: DOMRect | null;
	select: (action: EditorAction) => void;
};

export type SlashOptions = {
	actions: EditorAction[];
	/** Remonte l'état courant (null = menu fermé). */
	onState: (state: SlashState | null) => void;
	/** Rempli par le composant de menu pour intercepter ↑ ↓ ⏎ ⎋. */
	keyRef: { current: ((event: KeyboardEvent) => boolean) | null };
	/** Accès aux boîtes de dialogue de l'éditeur (lien, image, vidéo…). */
	getUi: () => EditorDialogs;
};

export const SlashCommand = Extension.create<SlashOptions>({
	name: "slashCommand",

	addOptions() {
		return {
			actions: [],
			onState: () => {},
			keyRef: { current: null },
			getUi: () => ({}) as EditorDialogs,
		};
	},

	addProseMirrorPlugins() {
		const options = this.options;
		return [
			Suggestion<EditorAction>({
				editor: this.editor,
				char: "/",
				allowSpaces: false,
				// Uniquement en début de bloc ou après une espace : un « / » au milieu
				// d'une URL (ou d'une date) ne doit pas ouvrir le menu.
				allowedPrefixes: [" ", "(", "\n"],
				startOfLine: false,
				items: ({ query }) => options.actions.filter((a) => matchAction(a, query)).slice(0, 14),
				command: ({ editor, range, props }) => {
					editor.chain().focus().deleteRange(range).run();
					props.run({ editor, ui: options.getUi() });
				},
				render: () => ({
					onStart: (props) => {
						options.onState({
							items: props.items,
							rect: props.clientRect?.() ?? null,
							select: (action) => props.command(action),
						});
					},
					onUpdate: (props) => {
						options.onState({
							items: props.items,
							rect: props.clientRect?.() ?? null,
							select: (action) => props.command(action),
						});
					},
					onKeyDown: (props) => options.keyRef.current?.(props.event) ?? false,
					onExit: () => options.onState(null),
				}),
			}),
		];
	},
});

/* -------------------------------------------------------------------------- */

export function SlashMenu({
	state,
	keyRef,
}: {
	state: SlashState | null;
	keyRef: { current: ((event: KeyboardEvent) => boolean) | null };
}) {
	const [index, setIndex] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	useEffect(() => setIndex(0), [state?.items]);

	// Le plugin délègue la navigation clavier au menu (qui seul connaît l'index).
	useEffect(() => {
		if (!state) {
			keyRef.current = null;
			return;
		}
		keyRef.current = (event) => {
			if (event.key === "ArrowDown") {
				setIndex((i) => (i + 1) % Math.max(1, state.items.length));
				return true;
			}
			if (event.key === "ArrowUp") {
				setIndex((i) => (i - 1 + state.items.length) % Math.max(1, state.items.length));
				return true;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				const item = state.items[index];
				if (item) state.select(item);
				return true;
			}
			return false;
		};
		return () => {
			keyRef.current = null;
		};
	}, [index, keyRef, state]);

	// L'élément survolé reste dans la zone visible du menu.
	useLayoutEffect(() => {
		listRef.current?.querySelector<HTMLElement>(`[data-idx="${index}"]`)?.scrollIntoView({
			block: "nearest",
		});
	}, [index]);

	if (!state || !mounted || state.items.length === 0) return null;

	const rect = state.rect;
	// Sous 640 px, le menu s'ancre en bas d'écran : au doigt, une liste qui suit
	// le curseur au milieu du texte est illisible et masquée par la main.
	const isMobile = typeof window !== "undefined" && window.innerWidth < 640;
	const style: React.CSSProperties = isMobile
		? { left: 8, right: 8, bottom: 8, maxHeight: "45dvh" }
		: {
				left: Math.min(rect?.left ?? 0, window.innerWidth - 320),
				top: (rect?.bottom ?? 0) + 8,
				width: 300,
				maxHeight: "min(22rem, 50dvh)",
			};

	let lastGroup = "";

	return createPortal(
		<div
			ref={listRef}
			role="listbox"
			aria-label="Insérer un bloc"
			style={style}
			className="fixed z-[130] overflow-y-auto overscroll-contain rounded-xl border border-white/12 bg-[#141416]/98 p-1.5 shadow-2xl backdrop-blur"
		>
			{state.items.map((item, i) => {
				const header = GROUP_LABEL[item.group] !== lastGroup ? GROUP_LABEL[item.group] : null;
				lastGroup = GROUP_LABEL[item.group];
				return (
					<div key={item.id}>
						{header && (
							<div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
								{header}
							</div>
						)}
						<button
							type="button"
							role="option"
							aria-selected={i === index}
							data-idx={i}
							onMouseDown={(e) => e.preventDefault()}
							onMouseEnter={() => setIndex(i)}
							onClick={() => state.select(item)}
							className={cn(
								"flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
								i === index ? "bg-dbz-orange/20 text-white" : "text-white/75 hover:bg-white/5"
							)}
						>
							<span className="grid size-8 shrink-0 place-items-center rounded-md bg-white/8">
								<item.icon className="size-4" />
							</span>
							<span className="min-w-0 flex-1">
								<span className="block truncate text-[13px] font-medium">{item.label}</span>
								{item.hint && (
									<span className="block truncate text-[11px] text-white/45">{item.hint}</span>
								)}
							</span>
						</button>
					</div>
				);
			})}
		</div>,
		document.body
	);
}
