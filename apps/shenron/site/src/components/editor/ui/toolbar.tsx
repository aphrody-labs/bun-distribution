"use client";

/**
 * Barres d'outils — **une seule source d'actions** (`commands.ts`), deux formes :
 *
 *   - grand écran : barre collée en haut, groupée, avec bouton « Insérer » ;
 *   - mobile : barre **en bas**, au-dessus du clavier virtuel, réduite à
 *     l'essentiel, le reste vivant dans une feuille d'insertion en plein écran.
 *
 * Le mobile n'est pas une dégradation du bureau : c'est l'inverse. Écrire au
 * pouce impose des cibles de 44 px, une barre qui suit le clavier et un menu qui
 * ne masque pas le texte — le bureau, lui, peut se permettre une barre dense.
 */
import { useMemo, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { ChevronDown, Plus, Search, Type } from "lucide-react";

import {
	GROUP_LABEL,
	matchAction,
	type ActionCtx,
	type ActionGroup,
	type EditorAction,
} from "../commands";
import { EditorPanel, ToolButton, ToolGroup, panelInputClass } from "./primitives";
import { cn } from "@/lib/utils";

type ActionState = Record<string, { active: boolean; disabled: boolean }>;

/** État d'activation de toutes les actions, recalculé à chaque transaction. */
export function useActionState(editor: Editor | null, actions: EditorAction[]): ActionState {
	return (
		useEditorState({
			editor,
			selector: ({ editor: ed }) => {
				if (!ed) return {};
				const out: ActionState = {};
				for (const a of actions) {
					out[a.id] = {
						active: a.isActive?.(ed) ?? false,
						disabled: a.isDisabled?.(ed) ?? false,
					};
				}
				return out;
			},
			// Comparaison structurelle : sans elle, chaque frappe rendrait la barre.
			equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
		}) ?? {}
	);
}

function group(actions: EditorAction[], ...names: ActionGroup[]) {
	return actions.filter((a) => names.includes(a.group));
}

/* -------------------------------------------------------------------------- */
/* Barre grand écran                                                          */
/* -------------------------------------------------------------------------- */

export function DesktopToolbar({
	actions,
	state,
	ctx,
	onInsert,
	extra,
}: {
	actions: EditorAction[];
	state: ActionState;
	ctx: ActionCtx;
	onInsert: () => void;
	extra?: React.ReactNode;
}) {
	const render = (list: EditorAction[]) =>
		list.map((a) => (
			<ToolButton
				key={a.id}
				icon={a.icon}
				label={a.shortcut ? `${a.label} (${a.shortcut})` : a.label}
				active={state[a.id]?.active}
				disabled={state[a.id]?.disabled}
				onClick={() => a.run(ctx)}
				compact
			/>
		));

	return (
		<div className="sticky top-0 z-20 hidden flex-wrap items-center gap-y-1 border-b border-white/10 bg-[#141416]/95 px-2 py-1.5 backdrop-blur md:flex">
			<ToolGroup>{render(group(actions, "historique"))}</ToolGroup>
			<ToolGroup>{render(group(actions, "structure"))}</ToolGroup>
			<ToolGroup>{render(group(actions, "format"))}</ToolGroup>
			<ToolGroup>{render(group(actions, "couleur", "alignement"))}</ToolGroup>
			<ToolGroup>{render(group(actions, "listes"))}</ToolGroup>
			<ToolGroup>{render(group(actions, "media"))}</ToolGroup>
			<ToolGroup>
				<button
					type="button"
					onMouseDown={(e) => e.preventDefault()}
					onClick={onInsert}
					className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white"
				>
					<Plus className="size-4" />
					Insérer
					<ChevronDown className="size-3 opacity-60" />
				</button>
			</ToolGroup>
			<div className="ml-auto flex items-center gap-0.5">
				{render(group(actions, "outils"))}
				{extra}
			</div>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* Barre mobile (au-dessus du clavier)                                        */
/* -------------------------------------------------------------------------- */

export function MobileToolbar({
	actions,
	state,
	ctx,
	onInsert,
	onFormat,
	keyboardOffset,
	visible,
}: {
	actions: EditorAction[];
	state: ActionState;
	ctx: ActionCtx;
	onInsert: () => void;
	onFormat: () => void;
	keyboardOffset: number;
	visible: boolean;
}) {
	const essentials = actions.filter((a) => a.essential);
	const undo = actions.find((a) => a.id === "undo");
	const redo = actions.find((a) => a.id === "redo");

	if (!visible) return null;

	return (
		<div
			// `fixed` + décalage clavier : la barre reste au contact du texte pendant
			// la frappe, là où le pouce l'attend.
			style={{ bottom: keyboardOffset }}
			className="fixed inset-x-0 z-[110] flex items-center gap-1 border-t border-white/10 bg-[#141416]/98 px-2 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden"
		>
			<button
				type="button"
				onMouseDown={(e) => e.preventDefault()}
				onClick={onInsert}
				aria-label="Insérer un bloc"
				className="grid size-11 shrink-0 place-items-center rounded-xl bg-dbz-orange text-black"
			>
				<Plus className="size-5" />
			</button>
			<div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
				<ToolButton icon={Type} label="Mise en forme" onClick={onFormat} />
				{essentials.map((a) => (
					<ToolButton
						key={a.id}
						icon={a.icon}
						label={a.label}
						active={state[a.id]?.active}
						disabled={state[a.id]?.disabled}
						onClick={() => a.run(ctx)}
					/>
				))}
			</div>
			{undo && (
				<ToolButton
					icon={undo.icon}
					label={undo.label}
					disabled={state[undo.id]?.disabled}
					onClick={() => undo.run(ctx)}
				/>
			)}
			{redo && (
				<ToolButton
					icon={redo.icon}
					label={redo.label}
					disabled={state[redo.id]?.disabled}
					onClick={() => redo.run(ctx)}
				/>
			)}
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* Feuilles : insertion & mise en forme                                       */
/* -------------------------------------------------------------------------- */

export function InsertSheet({
	open,
	onClose,
	actions,
	ctx,
	title = "Insérer",
	searchable = true,
}: {
	open: boolean;
	onClose: () => void;
	actions: EditorAction[];
	ctx: ActionCtx;
	title?: string;
	searchable?: boolean;
}) {
	const [query, setQuery] = useState("");
	const filtered = useMemo(() => actions.filter((a) => matchAction(a, query)), [actions, query]);

	const groups = useMemo(() => {
		const map = new Map<ActionGroup, EditorAction[]>();
		for (const a of filtered) {
			const list = map.get(a.group) ?? [];
			list.push(a);
			map.set(a.group, list);
		}
		return [...map.entries()];
	}, [filtered]);

	return (
		<EditorPanel title={title} open={open} onClose={onClose} wide>
			{searchable && (
				<div className="relative mb-3">
					<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40" />
					<input
						
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Chercher un bloc…"
						aria-label="Chercher un bloc à insérer"
						className={cn(panelInputClass, "pl-9")}
					/>
				</div>
			)}
			{groups.length === 0 && (
				<p className="py-6 text-center text-[13px] text-white/45">Aucun bloc ne correspond.</p>
			)}
			{groups.map(([name, list]) => (
				<section key={name} className="mb-4 last:mb-0">
					<h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">
						{GROUP_LABEL[name]}
					</h3>
					<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
						{list.map((a) => (
							<button
								key={a.id}
								type="button"
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => {
									a.run(ctx);
									onClose();
								}}
								className="flex min-h-16 flex-col items-start gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-left transition-colors hover:border-dbz-orange/50 hover:bg-dbz-orange/5"
							>
								<a.icon className="size-4 text-dbz-orange" />
								<span className="text-[13px] font-medium leading-tight text-white">{a.label}</span>
								{a.hint && (
									<span className="text-[11px] leading-tight text-white/45">{a.hint}</span>
								)}
							</button>
						))}
					</div>
				</section>
			))}
		</EditorPanel>
	);
}

/** Feuille « mise en forme » du mobile : titres, marques, alignement, couleur. */
export function FormatSheet({
	open,
	onClose,
	actions,
	state,
	ctx,
}: {
	open: boolean;
	onClose: () => void;
	actions: EditorAction[];
	state: ActionState;
	ctx: ActionCtx;
}) {
	const shown = group(actions, "structure", "format", "alignement", "couleur", "listes");
	const groups = useMemo(() => {
		const map = new Map<ActionGroup, EditorAction[]>();
		for (const a of shown) {
			const list = map.get(a.group) ?? [];
			list.push(a);
			map.set(a.group, list);
		}
		return [...map.entries()];
	}, [shown]);

	return (
		<EditorPanel title="Mise en forme" open={open} onClose={onClose} wide>
			{groups.map(([name, list]) => (
				<section key={name} className="mb-4 last:mb-0">
					<h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">
						{GROUP_LABEL[name]}
					</h3>
					<div className="flex flex-wrap gap-1.5">
						{list.map((a) => (
							<ToolButton
								key={a.id}
								icon={a.icon}
								label={a.label}
								showLabel
								active={state[a.id]?.active}
								disabled={state[a.id]?.disabled}
								onClick={() => a.run(ctx)}
								className="border border-white/10"
							/>
						))}
					</div>
				</section>
			))}
		</EditorPanel>
	);
}

/* -------------------------------------------------------------------------- */
/* Barre contextuelle (sélection)                                             */
/* -------------------------------------------------------------------------- */

export function SelectionActions({
	actions,
	state,
	ctx,
}: {
	actions: EditorAction[];
	state: ActionState;
	ctx: ActionCtx;
}) {
	const ids = ["bold", "italic", "underline", "strike", "highlight", "link", "color", "code"];
	const list = ids
		.map((id) => actions.find((a) => a.id === id))
		.filter((a): a is EditorAction => Boolean(a));

	return (
		<div className="flex items-center gap-0.5 rounded-xl border border-white/12 bg-[#141416]/98 p-1 shadow-2xl backdrop-blur">
			{list.map((a) => (
				<ToolButton
					key={a.id}
					icon={a.icon}
					label={a.label}
					active={state[a.id]?.active}
					disabled={state[a.id]?.disabled}
					onClick={() => a.run(ctx)}
					compact
				/>
			))}
		</div>
	);
}

;
