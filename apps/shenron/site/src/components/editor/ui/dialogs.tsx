"use client";

/**
 * Boîtes de dialogue du module d'édition — une par action qui demande une
 * saisie (lien, image, vidéo, badge Ki, bouton, couleur, tableau, recherche).
 *
 * Toutes partagent `EditorPanel` : popover centré sur grand écran, **feuille
 * glissante en bas d'écran sur mobile**, piège de focus, fermeture à Échap.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
	ArrowDown,
	ArrowUp,
	ChevronLeft,
	ChevronRight,
	Columns2,
	ImagePlus,
	Loader2,
	Rows3,
	Trash2,
} from "lucide-react";

import {
	EditorPanel,
	PanelButton,
	PanelField,
	SegmentedControl,
	panelInputClass,
} from "./primitives";
import type { FigurePlacement, FigureSize } from "../nodes/blocks";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Lien                                                                       */
/* -------------------------------------------------------------------------- */

export function LinkDialog({
	editor,
	open,
	onClose,
}: {
	editor: Editor;
	open: boolean;
	onClose: () => void;
}) {
	const [href, setHref] = useState("");
	const [label, setLabel] = useState("");
	const hadSelection = useRef(false);

	useEffect(() => {
		if (!open) return;
		const current = (editor.getAttributes("link").href as string) ?? "";
		const { from, to } = editor.state.selection;
		hadSelection.current = from !== to;
		setHref(current);
		setLabel(hadSelection.current ? editor.state.doc.textBetween(from, to, " ") : "");
	}, [editor, open]);

	const apply = () => {
		const url = href.trim();
		if (!url) {
			editor.chain().focus().extendMarkRange("link").unsetLink().run();
			onClose();
			return;
		}
		// Une saisie sans protocole vise le web public, pas une route locale.
		const normalized = /^(https?:|mailto:|\/|#)/i.test(url) ? url : `https://${url}`;
		if (!hadSelection.current && label.trim()) {
			editor
				.chain()
				.focus()
				.insertContent({
					type: "text",
					text: label.trim(),
					marks: [{ type: "link", attrs: { href: normalized } }],
				})
				.run();
		} else {
			editor.chain().focus().extendMarkRange("link").setLink({ href: normalized }).run();
		}
		onClose();
	};

	return (
		<EditorPanel
			title="Lien"
			open={open}
			onClose={onClose}
			footer={
				<>
					{editor.isActive("link") && (
						<PanelButton
							variant="danger"
							onClick={() => {
								editor.chain().focus().extendMarkRange("link").unsetLink().run();
								onClose();
							}}
						>
							Retirer
						</PanelButton>
					)}
					<PanelButton onClick={onClose}>Annuler</PanelButton>
					<PanelButton variant="primary" onClick={apply}>
						Appliquer
					</PanelButton>
				</>
			}
		>
			{!hadSelection.current && (
				<PanelField label="Texte affiché">
					<input
						className={panelInputClass}
						value={label}
						onChange={(e) => setLabel(e.target.value)}
						placeholder="Voir la fiche de Goku"
					/>
				</PanelField>
			)}
			<PanelField label="Adresse" hint="Une page du site (/wiki/…) ou une adresse complète.">
				<input
					
					className={panelInputClass}
					value={href}
					onChange={(e) => setHref(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							apply();
						}
					}}
					placeholder="https://dragonballfr.com/wiki/…"
					inputMode="url"
					autoCapitalize="off"
					autoCorrect="off"
				/>
			</PanelField>
		</EditorPanel>
	);
}

/* -------------------------------------------------------------------------- */
/* Image / figure                                                             */
/* -------------------------------------------------------------------------- */

const SIZE_OPTIONS: { value: FigureSize; label: string }[] = [
	{ value: "sm", label: "Petite" },
	{ value: "md", label: "Moyenne" },
	{ value: "lg", label: "Grande" },
	{ value: "full", label: "Pleine" },
];
const PLACEMENT_OPTIONS: { value: FigurePlacement; label: string }[] = [
	{ value: "left", label: "À gauche" },
	{ value: "center", label: "Centrée" },
	{ value: "right", label: "À droite" },
];

export function ImageDialog({
	editor,
	open,
	onClose,
	mode,
	upload,
	uploading,
	uploadError,
	allowLayout,
}: {
	editor: Editor;
	open: boolean;
	onClose: () => void;
	/** `figure` = image mise en page, `gallery` = grille, `banner` = bandeau titré. */
	mode: "figure" | "gallery" | "banner";
	upload: (files: File[]) => Promise<string[]>;
	uploading: boolean;
	uploadError: string | null;
	allowLayout: boolean;
}) {
	const [url, setUrl] = useState("");
	const [alt, setAlt] = useState("");
	const [size, setSize] = useState<FigureSize>("md");
	const [placement, setPlacement] = useState<FigurePlacement>("center");
	const fileRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (open) {
			setUrl("");
			setAlt("");
		}
	}, [open]);

	const insert = useCallback(
		(paths: string[]) => {
			const clean = paths.filter(Boolean);
			if (!clean.length) return;
			if (mode === "gallery") editor.chain().focus().insertGallery(clean).run();
			else if (mode === "banner") editor.chain().focus().insertBanner(clean[0]!).run();
			else
				for (const src of clean) {
					editor.chain().focus().insertFigure({ src, alt, placement, size }).run();
				}
			onClose();
		},
		[alt, editor, mode, onClose, placement, size]
	);

	const title = mode === "gallery" ? "Galerie d'images" : mode === "banner" ? "Bannière" : "Image";

	return (
		<EditorPanel
			title={title}
			open={open}
			onClose={onClose}
			footer={
				<>
					<PanelButton onClick={onClose}>Annuler</PanelButton>
					<PanelButton
						variant="primary"
						disabled={!url.trim()}
						onClick={() => insert([url.trim()])}
					>
						Insérer l&apos;adresse
					</PanelButton>
				</>
			}
		>
			<button
				type="button"
				onClick={() => fileRef.current?.click()}
				disabled={uploading}
				className={cn(
					"mb-4 flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/15 px-4 py-8 text-center transition-colors",
					"hover:border-dbz-orange hover:bg-dbz-orange/5 disabled:opacity-50"
				)}
			>
				{uploading ? (
					<Loader2 className="size-6 animate-spin text-dbz-orange" />
				) : (
					<ImagePlus className="size-6 text-white/50" />
				)}
				<span className="text-[14px] font-medium text-white">
					{uploading ? "Envoi en cours…" : "Choisir depuis l'appareil"}
				</span>
				<span className="text-[12px] text-white/45">
					PNG, JPEG, WebP ou GIF · on peut aussi glisser l&apos;image dans le texte
				</span>
			</button>
			<input
				ref={fileRef}
				type="file"
				accept="image/png,image/jpeg,image/webp,image/gif"
				multiple={mode !== "banner"}
				className="hidden"
				onChange={async (e) => {
					const files = Array.from(e.target.files ?? []);
					e.target.value = "";
					if (files.length) insert(await upload(files));
				}}
			/>

			{uploadError && (
				<p role="alert" className="mb-3 text-[13px] text-red-400">
					{uploadError}
				</p>
			)}

			<PanelField label="…ou adresse d'une image en ligne">
				<input
					className={panelInputClass}
					value={url}
					onChange={(e) => setUrl(e.target.value)}
					placeholder="https://…/image.webp"
					inputMode="url"
				/>
			</PanelField>

			{mode === "figure" && (
				<>
					<PanelField
						label="Texte alternatif"
						hint="Décrit l'image pour les lecteurs d'écran et le référencement."
					>
						<input
							className={panelInputClass}
							value={alt}
							onChange={(e) => setAlt(e.target.value)}
							placeholder="Goku en Super Saiyan face à Freezer"
						/>
					</PanelField>
					{allowLayout && (
						<>
							<PanelField label="Taille">
								<SegmentedControl
									ariaLabel="Taille de l'image"
									value={size}
									options={SIZE_OPTIONS}
									onChange={setSize}
								/>
							</PanelField>
							<PanelField label="Placement">
								<SegmentedControl
									ariaLabel="Placement de l'image"
									value={placement}
									options={PLACEMENT_OPTIONS}
									onChange={setPlacement}
								/>
							</PanelField>
						</>
					)}
				</>
			)}
		</EditorPanel>
	);
}

/* -------------------------------------------------------------------------- */
/* Vidéo                                                                      */
/* -------------------------------------------------------------------------- */

/** Normalise une URL YouTube (watch / short / youtu.be / live) vers l'embed sans cookie. */
function toEmbedUrl(url: string): string {
	const value = url.trim();
	const yt = value.match(
		/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([\w-]{11})/
	);
	if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
	const dailymotion = value.match(/dailymotion\.com\/video\/([a-z0-9]+)/i);
	if (dailymotion) return `https://www.dailymotion.com/embed/video/${dailymotion[1]}`;
	return value;
}

export function EmbedDialog({
	editor,
	open,
	onClose,
}: {
	editor: Editor;
	open: boolean;
	onClose: () => void;
}) {
	const [url, setUrl] = useState("");
	useEffect(() => {
		if (open) setUrl("");
	}, [open]);

	const apply = () => {
		const src = toEmbedUrl(url);
		if (!src) return;
		editor.chain().focus().insertEmbed(src).run();
		onClose();
	};

	return (
		<EditorPanel
			title="Vidéo"
			open={open}
			onClose={onClose}
			footer={
				<>
					<PanelButton onClick={onClose}>Annuler</PanelButton>
					<PanelButton variant="primary" disabled={!url.trim()} onClick={apply}>
						Insérer
					</PanelButton>
				</>
			}
		>
			<PanelField
				label="Adresse de la vidéo"
				hint="YouTube (watch, short, youtu.be), Dailymotion ou n'importe quel lecteur intégrable."
			>
				<input
					
					className={panelInputClass}
					value={url}
					onChange={(e) => setUrl(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							apply();
						}
					}}
					placeholder="https://www.youtube.com/watch?v=…"
					inputMode="url"
				/>
			</PanelField>
		</EditorPanel>
	);
}

/* -------------------------------------------------------------------------- */
/* Badge Ki & bouton                                                          */
/* -------------------------------------------------------------------------- */

export function KiDialog({
	editor,
	open,
	onClose,
}: {
	editor: Editor;
	open: boolean;
	onClose: () => void;
}) {
	const [ctx, setCtx] = useState("");
	const [value, setValue] = useState("");
	useEffect(() => {
		if (open) {
			setCtx("");
			setValue("");
		}
	}, [open]);

	const apply = () => {
		if (!value.trim()) return;
		editor
			.chain()
			.focus()
			.insertKiBadge({ ctx: ctx.trim() || "Ki", value: value.trim() })
			.run();
		onClose();
	};

	return (
		<EditorPanel
			title="Niveau de puissance"
			open={open}
			onClose={onClose}
			footer={
				<>
					<PanelButton onClick={onClose}>Annuler</PanelButton>
					<PanelButton variant="primary" disabled={!value.trim()} onClick={apply}>
						Insérer
					</PanelButton>
				</>
			}
		>
			<PanelField label="Contexte" hint="La saga ou le moment auquel cette valeur se rapporte.">
				<input
					
					className={panelInputClass}
					value={ctx}
					onChange={(e) => setCtx(e.target.value)}
					placeholder="Saga des Saiyans"
				/>
			</PanelField>
			<PanelField label="Valeur de Ki">
				<input
					className={panelInputClass}
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							apply();
						}
					}}
					placeholder="8 000"
				/>
			</PanelField>
			<p className="text-[12px] text-white/45">
				Le badge s&apos;insère au curseur — répétez l&apos;opération pour chaque palier de
				puissance.
			</p>
		</EditorPanel>
	);
}

export function ButtonDialog({
	editor,
	open,
	onClose,
}: {
	editor: Editor;
	open: boolean;
	onClose: () => void;
}) {
	const [label, setLabel] = useState("");
	const [href, setHref] = useState("");
	useEffect(() => {
		if (open) {
			setLabel("");
			setHref("");
		}
	}, [open]);

	const apply = () => {
		editor
			.chain()
			.focus()
			.insertActionButton({ label: label.trim() || "Bouton", href: href.trim() || "#" })
			.run();
		onClose();
	};

	return (
		<EditorPanel
			title="Bouton"
			open={open}
			onClose={onClose}
			footer={
				<>
					<PanelButton onClick={onClose}>Annuler</PanelButton>
					<PanelButton variant="primary" disabled={!label.trim()} onClick={apply}>
						Insérer
					</PanelButton>
				</>
			}
		>
			<PanelField label="Libellé">
				<input
					
					className={panelInputClass}
					value={label}
					onChange={(e) => setLabel(e.target.value)}
					placeholder="Lire la saga"
				/>
			</PanelField>
			<PanelField label="Destination">
				<input
					className={panelInputClass}
					value={href}
					onChange={(e) => setHref(e.target.value)}
					placeholder="/wiki/sagas/…"
					inputMode="url"
				/>
			</PanelField>
		</EditorPanel>
	);
}

/* -------------------------------------------------------------------------- */
/* Couleur                                                                    */
/* -------------------------------------------------------------------------- */

/* Or, orange, rouge et vert sont relevés sur la couverture de tankōbon
   (docs/couverture-analyse-visuelle.md) : ce sont les encres du support, pas
   des nuances choisies. Le rouge est la version éclaircie du rouge du titre —
   l'aplat exact (#de0b36) tombe à 3,97:1 sur le fond du site, et ceci colore
   du TEXTE. Le bleu de case n'entre pas dans cette liste pour la même raison :
   à 3,05:1, il n'est lisible qu'en aplat de décor. */
const PALETTE = [
	{ value: "#fefd03", label: "Or Saiyan" },
	{ value: "#e78220", label: "Orange kamé" },
	{ value: "#f10c3b", label: "Rouge" },
	{ value: "#4cc2ff", label: "Bleu ki" },
	{ value: "#2e9b41", label: "Vert namek" },
	{ value: "#a855f7", label: "Violet" },
	{ value: "#f472b6", label: "Rose" },
	{ value: "#ffffff", label: "Blanc" },
	{ value: "#9ca3af", label: "Gris" },
];

export function ColorDialog({
	editor,
	open,
	onClose,
}: {
	editor: Editor;
	open: boolean;
	onClose: () => void;
}) {
	const [custom, setCustom] = useState("#e78220");

	return (
		<EditorPanel
			title="Couleur"
			open={open}
			onClose={onClose}
			footer={
				<>
					<PanelButton
						onClick={() => {
							editor.chain().focus().unsetColor().unsetHighlight().run();
							onClose();
						}}
					>
						Réinitialiser
					</PanelButton>
					<PanelButton variant="primary" onClick={onClose}>
						Terminé
					</PanelButton>
				</>
			}
		>
			<PanelField label="Couleur du texte">
				<div className="grid grid-cols-5 gap-2 sm:grid-cols-9">
					{PALETTE.map((c) => (
						<button
							key={c.value}
							type="button"
							title={c.label}
							aria-label={`Texte ${c.label}`}
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => editor.chain().focus().setColor(c.value).run()}
							className="size-10 rounded-lg border border-white/15 transition-transform hover:scale-105 sm:size-9"
							style={{ backgroundColor: c.value }}
						/>
					))}
				</div>
			</PanelField>

			<PanelField label="Surlignage">
				<div className="grid grid-cols-5 gap-2 sm:grid-cols-9">
					{PALETTE.map((c) => (
						<button
							key={c.value}
							type="button"
							title={c.label}
							aria-label={`Surligner en ${c.label}`}
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => editor.chain().focus().toggleHighlight({ color: c.value }).run()}
							className="grid size-10 place-items-center rounded-lg border border-white/15 text-[11px] font-bold text-black transition-transform hover:scale-105 sm:size-9"
							style={{ backgroundColor: c.value }}
						>
							A
						</button>
					))}
				</div>
			</PanelField>

			<PanelField label="Couleur personnalisée">
				<div className="flex items-center gap-2">
					<input
						type="color"
						value={custom}
						onChange={(e) => setCustom(e.target.value)}
						aria-label="Choisir une couleur personnalisée"
						className="h-11 w-16 cursor-pointer rounded-lg border border-white/15 bg-transparent p-1"
					/>
					<PanelButton onClick={() => editor.chain().focus().setColor(custom).run()}>
						Appliquer au texte
					</PanelButton>
					<PanelButton
						onClick={() => editor.chain().focus().toggleHighlight({ color: custom }).run()}
					>
						Surligner
					</PanelButton>
				</div>
			</PanelField>
		</EditorPanel>
	);
}

/* -------------------------------------------------------------------------- */
/* Tableau                                                                    */
/* -------------------------------------------------------------------------- */

export function TableDialog({
	editor,
	open,
	onClose,
}: {
	editor: Editor;
	open: boolean;
	onClose: () => void;
}) {
	const actions: {
		label: string;
		icon: React.ComponentType<{ className?: string }>;
		run: () => void;
		danger?: boolean;
	}[] = [
		{
			label: "Ligne au-dessus",
			icon: ArrowUp,
			run: () => editor.chain().focus().addRowBefore().run(),
		},
		{
			label: "Ligne en dessous",
			icon: ArrowDown,
			run: () => editor.chain().focus().addRowAfter().run(),
		},
		{
			label: "Colonne à gauche",
			icon: ChevronLeft,
			run: () => editor.chain().focus().addColumnBefore().run(),
		},
		{
			label: "Colonne à droite",
			icon: ChevronRight,
			run: () => editor.chain().focus().addColumnAfter().run(),
		},
		{
			label: "Fusionner / séparer",
			icon: Columns2,
			run: () => editor.chain().focus().mergeOrSplit().run(),
		},
		{
			label: "Basculer l'en-tête",
			icon: Rows3,
			run: () => editor.chain().focus().toggleHeaderRow().run(),
		},
		{
			label: "Supprimer la ligne",
			icon: Trash2,
			run: () => editor.chain().focus().deleteRow().run(),
			danger: true,
		},
		{
			label: "Supprimer la colonne",
			icon: Trash2,
			run: () => editor.chain().focus().deleteColumn().run(),
			danger: true,
		},
		{
			label: "Supprimer le tableau",
			icon: Trash2,
			run: () => {
				editor.chain().focus().deleteTable().run();
				onClose();
			},
			danger: true,
		},
	];

	return (
		<EditorPanel title="Tableau" open={open} onClose={onClose}>
			<div className="grid grid-cols-2 gap-2">
				{actions.map((a) => (
					<button
						key={a.label}
						type="button"
						onMouseDown={(e) => e.preventDefault()}
						onClick={a.run}
						className={cn(
							"flex h-12 items-center gap-2 rounded-lg border border-white/12 px-3 text-left text-[13px] font-medium transition-colors",
							a.danger
								? "text-red-300 hover:border-red-400/40 hover:bg-red-500/10"
								: "text-white/80 hover:border-dbz-orange/50 hover:bg-white/5"
						)}
					>
						<a.icon className="size-4 shrink-0" />
						{a.label}
					</button>
				))}
			</div>
		</EditorPanel>
	);
}

/* -------------------------------------------------------------------------- */
/* Rechercher / remplacer                                                     */
/* -------------------------------------------------------------------------- */

type Match = { from: number; to: number };

/** Positions de toutes les occurrences dans le document (texte plat, insensible à la casse). */
function findMatches(editor: Editor, needle: string): Match[] {
	if (!needle) return [];
	const out: Match[] = [];
	const query = needle.toLowerCase();
	editor.state.doc.descendants((node, pos) => {
		if (!node.isText || !node.text) return true;
		const hay = node.text.toLowerCase();
		let idx = hay.indexOf(query);
		while (idx !== -1) {
			out.push({ from: pos + idx, to: pos + idx + needle.length });
			idx = hay.indexOf(query, idx + Math.max(1, needle.length));
		}
		return true;
	});
	return out;
}

export function FindReplaceDialog({
	editor,
	open,
	onClose,
}: {
	editor: Editor;
	open: boolean;
	onClose: () => void;
}) {
	const [needle, setNeedle] = useState("");
	const [replacement, setReplacement] = useState("");
	const [cursor, setCursor] = useState(0);

	const matches = useMemo(
		() => (open ? findMatches(editor, needle) : []),
		// La liste dépend du document : on la recalcule à chaque frappe de recherche.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[editor, needle, open, replacement]
	);

	const goTo = useCallback(
		(index: number) => {
			const m = matches[index];
			if (!m) return;
			setCursor(index);
			editor.chain().focus().setTextSelection({ from: m.from, to: m.to }).scrollIntoView().run();
		},
		[editor, matches]
	);

	const replaceOne = () => {
		const m = matches[cursor];
		if (!m) return;
		editor.chain().focus().insertContentAt({ from: m.from, to: m.to }, replacement).run();
	};

	const replaceAll = () => {
		if (!needle) return;
		// De la fin vers le début : remplacer en avançant décalerait les positions
		// suivantes de la longueur déjà changée.
		const chain = editor.chain().focus();
		for (const m of [...matches].toReversed()) {
			chain.insertContentAt({ from: m.from, to: m.to }, replacement);
		}
		chain.run();
	};

	return (
		<EditorPanel
			title="Rechercher et remplacer"
			open={open}
			onClose={onClose}
			footer={
				<>
					<PanelButton onClick={replaceOne} disabled={!matches.length}>
						Remplacer
					</PanelButton>
					<PanelButton variant="primary" onClick={replaceAll} disabled={!matches.length}>
						Tout remplacer ({matches.length})
					</PanelButton>
				</>
			}
		>
			<PanelField label="Rechercher">
				<input
					
					className={panelInputClass}
					value={needle}
					onChange={(e) => {
						setNeedle(e.target.value);
						setCursor(0);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							goTo(
								e.shiftKey ? Math.max(0, cursor - 1) : (cursor + 1) % Math.max(1, matches.length)
							);
						}
					}}
					placeholder="Texte à trouver"
				/>
			</PanelField>
			<PanelField label="Remplacer par">
				<input
					className={panelInputClass}
					value={replacement}
					onChange={(e) => setReplacement(e.target.value)}
					placeholder="Nouveau texte"
				/>
			</PanelField>
			<div className="flex items-center justify-between gap-2 text-[13px] text-white/55">
				<span aria-live="polite">
					{needle
						? matches.length
							? `${Math.min(cursor + 1, matches.length)} sur ${matches.length}`
							: "Aucune occurrence"
						: " "}
				</span>
				<span className="flex gap-1">
					<PanelButton onClick={() => goTo(Math.max(0, cursor - 1))} disabled={!matches.length}>
						Précédent
					</PanelButton>
					<PanelButton
						onClick={() => goTo((cursor + 1) % Math.max(1, matches.length))}
						disabled={!matches.length}
					>
						Suivant
					</PanelButton>
				</span>
			</div>
		</EditorPanel>
	);
}

/* -------------------------------------------------------------------------- */
/* Raccourcis clavier                                                         */
/* -------------------------------------------------------------------------- */

const SHORTCUTS: { keys: string; label: string }[] = [
	{ keys: "Ctrl + B", label: "Gras" },
	{ keys: "Ctrl + I", label: "Italique" },
	{ keys: "Ctrl + U", label: "Souligné" },
	{ keys: "Ctrl + Maj + S", label: "Barré" },
	{ keys: "Ctrl + E", label: "Code en ligne" },
	{ keys: "Ctrl + K", label: "Insérer un lien" },
	{ keys: "Ctrl + Alt + 2/3/4", label: "Titre de niveau 2, 3 ou 4" },
	{ keys: "Ctrl + Maj + 7/8", label: "Liste numérotée / à puces" },
	{ keys: "Ctrl + Z", label: "Annuler" },
	{ keys: "Ctrl + Maj + Z", label: "Rétablir" },
	{ keys: "Ctrl + S", label: "Enregistrer" },
	{ keys: "Ctrl + F", label: "Rechercher et remplacer" },
	{ keys: "Ctrl + /", label: "Cette liste" },
	{ keys: "/", label: "Menu d'insertion rapide (en début de ligne)" },
	{ keys: "# + espace", label: "Titre — markdown en direct" },
	{ keys: "- + espace", label: "Liste à puces" },
	{ keys: "> + espace", label: "Citation" },
	{ keys: "``` + espace", label: "Bloc de code" },
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
	return (
		<EditorPanel title="Raccourcis clavier" open={open} onClose={onClose} wide>
			<dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
				{SHORTCUTS.map((s) => (
					<div
						key={s.keys}
						className="flex items-center justify-between gap-3 border-b border-white/5 py-2"
					>
						<dt className="text-[13px] text-white/70">{s.label}</dt>
						<dd className="shrink-0 rounded-md border border-white/12 bg-black/40 px-2 py-1 font-mono text-[11px] text-white/80">
							{s.keys}
						</dd>
					</div>
				))}
			</dl>
		</EditorPanel>
	);
}
