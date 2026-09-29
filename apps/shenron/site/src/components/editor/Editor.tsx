"use client";

/**
 * **L'éditeur de texte du site** — un seul composant pour les articles, le wiki,
 * les sections CMS, la home et les champs d'administration.
 *
 * Il remplace les quatre éditeurs qui coexistaient (Tiptap des articles,
 * CodeMirror du wiki, CodeMirror des fiches, zones de texte nues) et qui
 * divergeaient sur tout : boutons, raccourcis, upload, aperçu, sauvegarde.
 *
 * Ce qu'il apporte, dans l'ordre d'importance pour qui rédige :
 *   - **rien ne se perd** : autosauvegarde locale immédiate + brouillon serveur,
 *     reprise explicite au retour, garde-fou avant de quitter la page ;
 *   - **mobile de plein droit** : barre d'outils en bas collée au clavier
 *     virtuel, feuilles d'insertion plein écran, cibles tactiles de 44 px ;
 *   - **deux vues du même document** : riche (ce qu'on voit est ce qui sera
 *     publié) et source (markdown + HTML), avec vérification que l'aller-retour
 *     entre les deux est fidèle **avant** d'écrire quoi que ce soit ;
 *   - un vocabulaire de blocs unique (`commands.ts`) exposé partout de la même
 *     façon : barre, menu « / », feuille mobile.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { FileHandler } from "@tiptap/extension-file-handler";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { Eye, FileCode2, GripVertical, Minimize2, PenLine } from "lucide-react";

import { EMPTY_DOC, buildExtensions, type PresetName } from "./schema";
import { actionsFor, insertActionsFor, type ActionCtx, type EditorDialogs } from "./commands";
import { parseMarkdown, roundTripReport } from "./markdown/parse";
import { serializeMarkdown } from "./markdown/serialize";
import { useAutosave } from "./hooks/use-autosave";
import { useUploader } from "./hooks/use-uploader";
import { useVirtualKeyboard } from "./hooks/use-virtual-keyboard";
import { SlashCommand, SlashMenu, type SlashState } from "./ui/slash";
import {
	DesktopToolbar,
	FormatSheet,
	InsertSheet,
	MobileToolbar,
	SelectionActions,
	useActionState,
} from "./ui/toolbar";
import {
	ButtonDialog,
	ColorDialog,
	EmbedDialog,
	FindReplaceDialog,
	ImageDialog,
	KiDialog,
	LinkDialog,
	ShortcutsDialog,
	TableDialog,
} from "./ui/dialogs";
import { RecoveryBanner, StatusBar } from "./ui/status";
import { SourceView } from "./ui/source";
import { cn } from "@/lib/utils";

// Affordances de saisie (scopées `.sh-editor`) + direction « presse » du journal
// (scopée `.editorial`) : l'éditeur d'article doit montrer la mise en page finale.
import "@shenron/ui/editor.css";
import "@shenron/ui/editorial.css";

type EditorFormat = "doc" | "markdown";
export type EditorMode = "rich" | "source" | "preview";

export type ShenronEditorProps = {
	/** `markdown` (wiki, sections, champs) ou `doc` (articles, JSON ProseMirror). */
	format?: EditorFormat;
	/** Contenu initial. Les frappes suivantes remontent par `onChange`. */
	value?: string | JSONContent | null;
	/** Contenu markdown modifié (format `markdown`). */
	onChangeMarkdown?: (markdown: string, stats: EditorStats) => void;
	/** Document modifié (format `doc`). */
	onChangeDoc?: (doc: JSONContent, stats: EditorStats) => void;
	preset?: PresetName;
	placeholder?: string;
	/** Sous-dossier d'upload côté bot (namespace des images). */
	uploadSubdir?: string;
	uploadEndpoint?: string;
	/** Active l'autosauvegarde sous cette clé logique (`post:12`, `wiki:db_characters:3:description`…). */
	autosaveKey?: string;
	autosaveLabel?: string;
	/** Ctrl+S. */
	onSave?: () => void;
	minHeight?: string;
	maxHeight?: string;
	readOnly?: boolean;
	/** Rendu public injecté pour l'onglet « Aperçu » (le vrai, pas une imitation). */
	renderPreview?: (source: string) => React.ReactNode;
	/** Vues proposées. Par défaut : riche + source (+ aperçu si `renderPreview`). */
	modes?: EditorMode[];
	className?: string;
	ariaLabel?: string;
	/** Classes de la surface de saisie (par défaut, celles de la page publique). */
	contentClass?: string;
	/** Classes du conteneur de saisie (thème de la surface). */
	surfaceClass?: string;
	/** Barre d'outils réduite (champs courts). */
	compact?: boolean;
};

export type EditorStats = { words: number; characters: number };

const DEFAULT_CONTENT_CLASS: Record<EditorFormat, string> = {
	doc: "ed-prose",
	markdown: "wiki-content prose prose-invert max-w-none",
};

/**
 * Thème de la surface de saisie. Un article s'écrit sur le papier du journal
 * (`.editorial`), une page wiki sur le fond sombre du site : dans les deux cas,
 * on rédige dans la mise en page réelle de la publication.
 */
const DEFAULT_SURFACE_CLASS: Record<EditorFormat, string> = {
	doc: "editorial ed-editor",
	markdown: "",
};

export function ShenronEditor({
	format = "markdown",
	value,
	onChangeMarkdown,
	onChangeDoc,
	preset = format === "doc" ? "article" : "wiki",
	placeholder = "Commencez à écrire… tapez « / » pour insérer un bloc.",
	uploadSubdir = "inline",
	uploadEndpoint,
	autosaveKey,
	autosaveLabel,
	onSave,
	minHeight = "18rem",
	maxHeight = "70vh",
	readOnly = false,
	renderPreview,
	modes,
	className,
	ariaLabel = "Éditeur de contenu",
	contentClass,
	surfaceClass,
	compact = false,
}: ShenronEditorProps) {
	const extensions = useMemo(() => buildExtensions(preset), [preset]);
	const actions = useMemo(() => actionsFor(preset), [preset]);
	const insertActions = useMemo(() => insertActionsFor(preset), [preset]);

	/* ---- Vues disponibles -------------------------------------------------- */
	const availableModes = useMemo<EditorMode[]>(() => {
		if (modes) return modes;
		const base: EditorMode[] = format === "markdown" ? ["rich", "source"] : ["rich"];
		return renderPreview ? [...base, "preview"] : base;
	}, [format, modes, renderPreview]);
	const [mode, setMode] = useState<EditorMode>("rich");

	/* ---- État local -------------------------------------------------------- */
	const initialSource = useMemo(
		() => (format === "markdown" ? String(value ?? "") : ""),
		// Contenu initial seulement : l'éditeur devient la source de vérité ensuite.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[]
	);
	const [source, setSource] = useState(initialSource);
	const [stats, setStats] = useState<EditorStats>({ words: 0, characters: 0 });
	const [fullscreen, setFullscreen] = useState(false);
	const [slash, setSlash] = useState<SlashState | null>(null);
	const [focused, setFocused] = useState(false);
	const [dialog, setDialog] = useState<
		| null
		| "link"
		| "image"
		| "gallery"
		| "banner"
		| "embed"
		| "ki"
		| "button"
		| "color"
		| "table"
		| "find"
		| "shortcuts"
		| "insert"
		| "format"
	>(null);

	const slashKeyRef = useRef<((e: KeyboardEvent) => boolean) | null>(null);
	const uiRef = useRef<EditorDialogs>(null as unknown as EditorDialogs);
	const containerRef = useRef<HTMLDivElement>(null);

	const uploader = useUploader(uploadSubdir, uploadEndpoint);
	const keyboardOffset = useVirtualKeyboard();
	const autosave = useAutosave({
		key: autosaveKey,
		format: format === "doc" ? "doc" : "markdown",
		label: autosaveLabel,
		enabled: Boolean(autosaveKey) && !readOnly,
	});

	// Les rappels du parent changent d'identité à chaque rendu : on les garde en
	// ref pour ne jamais avoir à recréer l'éditeur (ce qui perdrait le focus et
	// l'historique d'annulation à chaque frappe).
	const emitRef = useRef({ onChangeMarkdown, onChangeDoc });
	useEffect(() => {
		emitRef.current = { onChangeMarkdown, onChangeDoc };
	}, [onChangeDoc, onChangeMarkdown]);

	// Même raison pour l'autosauvegarde : `onUpdate` est figé à la création de
	// l'éditeur, il ne doit pas capturer un `schedule` périmé.
	const autosaveRef = useRef(autosave);
	autosaveRef.current = autosave;

	/** Envoie puis insère une série d'images à la position courante. */
	const insertImages = useCallback(
		async (target: Editor, files: File[]) => {
			const paths = await uploader.uploadAll(files);
			for (const src of paths) {
				if (target.schema.nodes.figure) target.chain().focus().insertFigure({ src, alt: "" }).run();
				else target.chain().focus().setImage({ src, alt: "" }).run();
			}
		},
		[uploader]
	);

	/* ---- Éditeur ----------------------------------------------------------- */
	const editor = useEditor(
		{
			// Next rend d'abord côté serveur : sans ce drapeau, Tiptap monterait
			// pendant le SSR et provoquerait une erreur d'hydratation.
			immediatelyRender: false,
			editable: !readOnly,
			extensions: [
				...extensions,
				Placeholder.configure({ placeholder }),
				CharacterCount.configure(),
				SlashCommand.configure({
					actions: insertActions,
					onState: setSlash,
					keyRef: slashKeyRef,
					getUi: () => uiRef.current,
				}),
				FileHandler.configure({
					allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
					onDrop: (ed, files) => void insertImages(ed, files),
					onPaste: (ed, files) => void insertImages(ed, files),
				}),
			],
			content:
				format === "markdown"
					? parseMarkdown(initialSource, extensions)
					: ((value as JSONContent) ?? EMPTY_DOC),
			editorProps: {
				attributes: {
					class: cn(contentClass ?? DEFAULT_CONTENT_CLASS[format], "focus:outline-none"),
					spellcheck: "true",
					"aria-label": ariaLabel,
				},
			},
			onFocus: () => setFocused(true),
			onBlur: () => setFocused(false),
			onUpdate: ({ editor: ed }) => {
				const next: EditorStats = {
					words: ed.storage.characterCount?.words?.() ?? 0,
					characters: ed.storage.characterCount?.characters?.() ?? 0,
				};
				setStats(next);
				if (format === "markdown") {
					const md = serializeMarkdown(ed.getJSON());
					setSource(md);
					emitRef.current.onChangeMarkdown?.(md, next);
					autosaveRef.current.schedule(md);
				} else {
					const doc = ed.getJSON();
					emitRef.current.onChangeDoc?.(doc, next);
					autosaveRef.current.schedule(JSON.stringify(doc));
				}
			},
		},
		[extensions, readOnly]
	);

	/* ---- Fidélité de l'aller-retour markdown ------------------------------- */
	const [roundTripWarning, setRoundTripWarning] = useState<string | null>(null);
	useEffect(() => {
		if (format !== "markdown" || !initialSource.trim()) return;
		const report = roundTripReport(initialSource, extensions);
		setRoundTripWarning(
			report.faithful
				? null
				: "La vue riche ne restitue pas ce contenu à l'identique — relisez en mode Source avant d'enregistrer."
		);
	}, [extensions, format, initialSource]);

	/* ---- Boîtes de dialogue ------------------------------------------------ */
	const ui = useMemo<EditorDialogs>(
		() => ({
			link: () => setDialog("link"),
			image: () => setDialog("image"),
			gallery: () => setDialog("gallery"),
			banner: () => setDialog("banner"),
			embed: () => setDialog("embed"),
			ki: () => setDialog("ki"),
			button: () => setDialog("button"),
			color: () => setDialog("color"),
			table: () => setDialog("table"),
			find: () => setDialog("find"),
			shortcuts: () => setDialog("shortcuts"),
			fullscreen: () => setFullscreen((f) => !f),
			source: () => setMode((m) => (m === "source" ? "rich" : "source")),
			preview: () => setMode((m) => (m === "preview" ? "rich" : "preview")),
		}),
		[]
	);
	uiRef.current = ui;

	const ctx = useMemo<ActionCtx | null>(() => (editor ? { editor, ui } : null), [editor, ui]);
	const actionState = useActionState(editor, actions);

	/* ---- Raccourcis globaux ------------------------------------------------ */
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const onKey = (e: KeyboardEvent) => {
			const mod = e.ctrlKey || e.metaKey;
			// `stopPropagation` : plusieurs écrans d'admin posent leur propre écouteur
			// Ctrl+S sur `window` — sans cela, un enregistrement partirait en double.
			if (mod && e.key.toLowerCase() === "s") {
				e.preventDefault();
				e.stopPropagation();
				onSave?.();
			} else if (mod && e.key.toLowerCase() === "f") {
				e.preventDefault();
				e.stopPropagation();
				setDialog("find");
			} else if (mod && e.key === "/") {
				e.preventDefault();
				e.stopPropagation();
				setDialog("shortcuts");
			} else if (e.key === "Escape" && fullscreen) {
				setFullscreen(false);
			}
		};
		el.addEventListener("keydown", onKey);
		return () => el.removeEventListener("keydown", onKey);
	}, [fullscreen, onSave]);

	/* ---- Bascule des vues -------------------------------------------------- */
	const switchMode = useCallback(
		(next: EditorMode) => {
			if (!editor) return;
			// Source → riche : on relit le texte que l'admin vient d'écrire.
			if (mode === "source" && next !== "source") {
				editor.commands.setContent(parseMarkdown(source, extensions), { emitUpdate: false });
			}
			setMode(next);
		},
		[editor, extensions, mode, source]
	);

	const onSourceChange = useCallback(
		(text: string) => {
			setSource(text);
			emitRef.current.onChangeMarkdown?.(text, stats);
			autosave.schedule(text);
		},
		[autosave, stats]
	);

	/* ---- Reprise d'un brouillon -------------------------------------------- */

	// Après un vrai enregistrement, le brouillon serveur reste en place et vaut
	// exactement le contenu rechargé : proposer de « reprendre » ce qu'on a déjà
	// sous les yeux serait du bruit. On ne montre la bannière que s'il diffère.
	useEffect(() => {
		const draft = autosave.recovered;
		if (!draft) return;
		const loaded = format === "markdown" ? initialSource : JSON.stringify(value ?? EMPTY_DOC);
		const same = draft.content.replace(/\s+/g, " ").trim() === loaded.replace(/\s+/g, " ").trim();
		if (same) autosave.dismissRecovered();
		// `autosave` change d'identité à chaque rendu : on ne suit que le brouillon.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [autosave.recovered, format, initialSource]);

	const restoreDraft = useCallback(() => {
		const draft = autosave.recovered;
		if (!draft || !editor) return;
		if (format === "markdown") {
			setSource(draft.content);
			editor.commands.setContent(parseMarkdown(draft.content, extensions));
		} else {
			try {
				editor.commands.setContent(JSON.parse(draft.content) as JSONContent);
			} catch {
				// Brouillon illisible : mieux vaut ne rien casser.
			}
		}
		autosave.dismissRecovered();
	}, [autosave, editor, extensions, format]);

	/* ---- Rendu -------------------------------------------------------------- */
	if (!editor || !ctx) {
		// Squelette à la hauteur réelle : pas de saut de mise en page entre le
		// rendu serveur et le montage client.
		return (
			<div className={cn("rounded-xl border border-white/10 bg-white/[0.03]", className)}>
				<div className="h-12 border-b border-white/10" />
				<div className="animate-pulse bg-white/[0.02]" style={{ height: minHeight }} />
			</div>
		);
	}

	return (
		<div
			ref={containerRef}
			className={cn(
				"sh-editor flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0e0e10]",
				fullscreen && "sh-editor-fullscreen fixed inset-0 z-[100] rounded-none",
				className
			)}
		>
			{/* ---- Onglets de vue ------------------------------------------- */}
			{availableModes.length > 1 && (
				<div className="flex items-center gap-1 border-b border-white/10 bg-[#141416] px-2 py-1.5">
					{availableModes.map((m) => (
						<button
							key={m}
							type="button"
							onClick={() => switchMode(m)}
							aria-pressed={mode === m}
							className={cn(
								"inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors",
								mode === m
									? "bg-white/10 text-white"
									: "text-white/55 hover:bg-white/5 hover:text-white"
							)}
						>
							{m === "rich" && <PenLine className="size-3.5" />}
							{m === "source" && <FileCode2 className="size-3.5" />}
							{m === "preview" && <Eye className="size-3.5" />}
							{m === "rich" ? "Édition" : m === "source" ? "Source" : "Aperçu"}
						</button>
					))}
					{fullscreen && (
						<button
							type="button"
							onClick={() => setFullscreen(false)}
							className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-white/55 hover:bg-white/5 hover:text-white"
						>
							<Minimize2 className="size-3.5" />
							Quitter le plein écran
						</button>
					)}
				</div>
			)}

			{/* ---- Reprise de brouillon -------------------------------------- */}
			{autosave.recovered && (
				<RecoveryBanner
					savedAt={autosave.recovered.savedAt}
					origin={autosave.recovered.origin}
					onRestore={restoreDraft}
					onDismiss={autosave.dismissRecovered}
				/>
			)}

			{mode === "rich" && !readOnly && (
				<DesktopToolbar
					actions={compact ? actions.filter((a) => a.group !== "outils") : actions}
					state={actionState}
					ctx={ctx}
					onInsert={() => setDialog("insert")}
				/>
			)}

			{uploader.error && (
				<p
					role="alert"
					className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-[13px] text-red-300"
				>
					{uploader.error}
				</p>
			)}

			{/* ---- Surface d'édition ----------------------------------------- */}
			{mode === "rich" && (
				<div
					className={cn(
						"relative overflow-y-auto px-4 py-6 sm:px-8",
						surfaceClass ?? DEFAULT_SURFACE_CLASS[format]
					)}
					style={{ minHeight, maxHeight: fullscreen ? undefined : maxHeight }}
				>
					<div className="mx-auto w-full" style={{ maxWidth: "var(--ed-measure, 46rem)" }}>
						<EditorContent editor={editor} />
					</div>

					{/* Poignée de déplacement des blocs (pointeur fin uniquement : au
					    doigt, elle entrerait en conflit avec le défilement). */}
					{!readOnly && (
						<DragHandle editor={editor} className="hidden md:block">
							<span className="grid size-6 cursor-grab place-items-center rounded text-white/30 hover:bg-white/10 hover:text-white/70">
								<GripVertical className="size-4" />
							</span>
						</DragHandle>
					)}

					{/* Barre contextuelle de sélection */}
					{!readOnly && (
						<BubbleMenu
							editor={editor}
							options={{ placement: "top", offset: 8 }}
							shouldShow={({ editor: ed, from, to }) =>
								from !== to && !ed.isActive("codeBlock") && !ed.isActive("image")
							}
						>
							<SelectionActions actions={actions} state={actionState} ctx={ctx} />
						</BubbleMenu>
					)}
				</div>
			)}

			{mode === "source" && (
				<div style={{ minHeight }}>
					<SourceView
						value={source}
						onChange={onSourceChange}
						height={fullscreen ? "calc(100dvh - 8rem)" : maxHeight}
						readOnly={readOnly}
					/>
				</div>
			)}

			{mode === "preview" && (
				<div className="overflow-y-auto px-4 py-6 sm:px-8" style={{ minHeight, maxHeight }}>
					<div className="mx-auto w-full" style={{ maxWidth: "var(--ed-measure, 46rem)" }}>
						{renderPreview?.(source) ?? (
							<p className="italic text-white/45">Aucun aperçu disponible.</p>
						)}
					</div>
				</div>
			)}

			<StatusBar
				words={stats.words}
				characters={stats.characters}
				status={autosave.status}
				savedAt={autosave.savedAt}
				warning={roundTripWarning}
			/>

			{/* ---- Barre mobile + feuilles ----------------------------------- */}
			{mode === "rich" && !readOnly && (
				<MobileToolbar
					actions={actions}
					state={actionState}
					ctx={ctx}
					onInsert={() => setDialog("insert")}
					onFormat={() => setDialog("format")}
					keyboardOffset={keyboardOffset}
					visible={focused || fullscreen}
				/>
			)}

			<SlashMenu state={slash} keyRef={slashKeyRef} />

			<InsertSheet
				open={dialog === "insert"}
				onClose={() => setDialog(null)}
				actions={insertActions}
				ctx={ctx}
			/>
			<FormatSheet
				open={dialog === "format"}
				onClose={() => setDialog(null)}
				actions={actions}
				state={actionState}
				ctx={ctx}
			/>
			<LinkDialog editor={editor} open={dialog === "link"} onClose={() => setDialog(null)} />
			<ImageDialog
				editor={editor}
				open={dialog === "image" || dialog === "gallery" || dialog === "banner"}
				onClose={() => setDialog(null)}
				mode={dialog === "gallery" ? "gallery" : dialog === "banner" ? "banner" : "figure"}
				upload={uploader.uploadAll}
				uploading={uploader.uploading}
				uploadError={uploader.error}
				allowLayout={Boolean(editor.schema.nodes.figure)}
			/>
			<EmbedDialog editor={editor} open={dialog === "embed"} onClose={() => setDialog(null)} />
			<KiDialog editor={editor} open={dialog === "ki"} onClose={() => setDialog(null)} />
			<ButtonDialog editor={editor} open={dialog === "button"} onClose={() => setDialog(null)} />
			<ColorDialog editor={editor} open={dialog === "color"} onClose={() => setDialog(null)} />
			<TableDialog editor={editor} open={dialog === "table"} onClose={() => setDialog(null)} />
			<FindReplaceDialog editor={editor} open={dialog === "find"} onClose={() => setDialog(null)} />
			<ShortcutsDialog open={dialog === "shortcuts"} onClose={() => setDialog(null)} />
		</div>
	);
}
