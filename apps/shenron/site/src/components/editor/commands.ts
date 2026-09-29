/**
 * Catalogue **unique** des actions d'édition.
 *
 * Barre d'outils, menu « / », feuille d'insertion mobile et palette de commandes
 * lisent tous cette liste : une action ajoutée ici apparaît partout, avec le même
 * libellé, la même icône et le même raccourci. C'est ce qui évite la dérive
 * historique entre les quatre éditeurs du site (chacun avec ses propres boutons).
 */
import type { Editor } from "@tiptap/react";
import {
	AlignCenter,
	AlignJustify,
	AlignLeft,
	AlignRight,
	Baseline,
	Bold,
	Code,
	Code2,
	Columns2,
	Columns3,
	Eye,
	FileCode2,
	Gauge,
	Heading2,
	Heading3,
	Heading4,
	Highlighter,
	ImagePlus,
	Images,
	Info,
	Italic,
	Keyboard,
	Link2,
	Link2Off,
	List,
	ListOrdered,
	ListTree,
	Maximize2,
	Minus,
	MonitorPlay,
	MousePointerClick,
	Palette,
	PanelTop,
	Pilcrow,
	Quote,
	Redo2,
	RemoveFormatting,
	Search,
	SeparatorHorizontal,
	Strikethrough,
	Subscript as SubIcon,
	Superscript as SupIcon,
	Table as TableIcon,
	Trash2,
	Underline as UnderlineIcon,
	Undo2,
} from "lucide-react";

import { EDITOR_PRESETS, type PresetName } from "./schema";
import type { CalloutKind } from "./nodes/blocks";

export type ActionGroup =
	| "historique"
	| "structure"
	| "format"
	| "couleur"
	| "alignement"
	| "listes"
	| "media"
	| "mise-en-page"
	| "univers"
	| "outils";

export const GROUP_LABEL: Record<ActionGroup, string> = {
	historique: "Historique",
	structure: "Structure",
	format: "Mise en forme",
	couleur: "Couleur",
	alignement: "Alignement",
	listes: "Listes & blocs",
	media: "Médias",
	"mise-en-page": "Mise en page",
	univers: "Univers Dragon Ball",
	outils: "Outils",
};

/** Boîtes de dialogue pilotées par l'éditeur (ouvertes par les actions). */
export type EditorDialogs = {
	link: () => void;
	image: () => void;
	gallery: () => void;
	banner: () => void;
	embed: () => void;
	ki: () => void;
	button: () => void;
	color: () => void;
	table: () => void;
	find: () => void;
	shortcuts: () => void;
	fullscreen: () => void;
	source: () => void;
	preview: () => void;
};

export type ActionCtx = { editor: Editor; ui: EditorDialogs };

export type EditorAction = {
	id: string;
	label: string;
	/** Phrase courte affichée dans le menu d'insertion. */
	hint?: string;
	icon: React.ComponentType<{ className?: string }>;
	group: ActionGroup;
	/** Mots-clés supplémentaires pour la recherche du menu « / ». */
	keywords?: string[];
	/** Raccourci affiché (à titre indicatif : Tiptap gère les siens). */
	shortcut?: string;
	/** Capacité du preset requise pour proposer l'action. */
	requires?: "typography" | "media" | "layout" | "tables" | "code" | "universe" | "headings";
	/** Présente dans le menu d'insertion (« / » et feuille mobile). */
	insert?: boolean;
	/** Épinglée dans la barre compacte mobile. */
	essential?: boolean;
	run: (ctx: ActionCtx) => void;
	isActive?: (editor: Editor) => boolean;
	isDisabled?: (editor: Editor) => boolean;
};

const CALLOUTS: { kind: CalloutKind; label: string }[] = [
	{ kind: "info", label: "Encadré info" },
	{ kind: "success", label: "Encadré succès" },
	{ kind: "warn", label: "Encadré attention" },
	{ kind: "danger", label: "Encadré danger" },
	{ kind: "neutral", label: "Encadré neutre" },
];

/** Toutes les actions connues, dans l'ordre d'affichage de la barre d'outils. */
const ALL_ACTIONS: EditorAction[] = [
	/* ---- Historique ------------------------------------------------------- */
	{
		id: "undo",
		label: "Annuler",
		icon: Undo2,
		group: "historique",
		shortcut: "Ctrl+Z",
		run: ({ editor }) => editor.chain().focus().undo().run(),
		isDisabled: (e) => !e.can().undo(),
	},
	{
		id: "redo",
		label: "Rétablir",
		icon: Redo2,
		group: "historique",
		shortcut: "Ctrl+Maj+Z",
		run: ({ editor }) => editor.chain().focus().redo().run(),
		isDisabled: (e) => !e.can().redo(),
	},

	/* ---- Structure -------------------------------------------------------- */
	{
		id: "paragraph",
		label: "Paragraphe",
		icon: Pilcrow,
		group: "structure",
		hint: "Texte courant",
		insert: true,
		run: ({ editor }) => editor.chain().focus().setParagraph().run(),
		isActive: (e) => e.isActive("paragraph"),
	},
	{
		id: "h2",
		label: "Titre de section",
		icon: Heading2,
		group: "structure",
		requires: "headings",
		shortcut: "Ctrl+Alt+2",
		hint: "Grand titre dans le corps",
		insert: true,
		essential: true,
		run: ({ editor }) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
		isActive: (e) => e.isActive("heading", { level: 2 }),
	},
	{
		id: "h3",
		label: "Sous-titre",
		icon: Heading3,
		group: "structure",
		requires: "headings",
		shortcut: "Ctrl+Alt+3",
		insert: true,
		run: ({ editor }) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
		isActive: (e) => e.isActive("heading", { level: 3 }),
	},
	{
		id: "h4",
		label: "Titre mineur",
		icon: Heading4,
		group: "structure",
		requires: "headings",
		shortcut: "Ctrl+Alt+4",
		insert: true,
		run: ({ editor }) => editor.chain().focus().toggleHeading({ level: 4 }).run(),
		isActive: (e) => e.isActive("heading", { level: 4 }),
	},

	/* ---- Mise en forme ---------------------------------------------------- */
	{
		id: "bold",
		label: "Gras",
		icon: Bold,
		group: "format",
		shortcut: "Ctrl+B",
		essential: true,
		run: ({ editor }) => editor.chain().focus().toggleBold().run(),
		isActive: (e) => e.isActive("bold"),
	},
	{
		id: "italic",
		label: "Italique",
		icon: Italic,
		group: "format",
		shortcut: "Ctrl+I",
		essential: true,
		run: ({ editor }) => editor.chain().focus().toggleItalic().run(),
		isActive: (e) => e.isActive("italic"),
	},
	{
		id: "underline",
		label: "Souligné",
		icon: UnderlineIcon,
		group: "format",
		shortcut: "Ctrl+U",
		run: ({ editor }) => editor.chain().focus().toggleUnderline().run(),
		isActive: (e) => e.isActive("underline"),
	},
	{
		id: "strike",
		label: "Barré",
		icon: Strikethrough,
		group: "format",
		shortcut: "Ctrl+Maj+S",
		run: ({ editor }) => editor.chain().focus().toggleStrike().run(),
		isActive: (e) => e.isActive("strike"),
	},
	{
		id: "highlight",
		label: "Surligné",
		icon: Highlighter,
		group: "format",
		requires: "typography",
		run: ({ editor }) => editor.chain().focus().toggleHighlight().run(),
		isActive: (e) => e.isActive("highlight"),
	},
	{
		id: "subscript",
		label: "Indice",
		icon: SubIcon,
		group: "format",
		requires: "typography",
		run: ({ editor }) => editor.chain().focus().toggleSubscript().run(),
		isActive: (e) => e.isActive("subscript"),
	},
	{
		id: "superscript",
		label: "Exposant",
		icon: SupIcon,
		group: "format",
		requires: "typography",
		run: ({ editor }) => editor.chain().focus().toggleSuperscript().run(),
		isActive: (e) => e.isActive("superscript"),
	},
	{
		id: "code",
		label: "Code en ligne",
		icon: Code,
		group: "format",
		requires: "code",
		shortcut: "Ctrl+E",
		run: ({ editor }) => editor.chain().focus().toggleCode().run(),
		isActive: (e) => e.isActive("code"),
	},
	{
		id: "clear-format",
		label: "Effacer la mise en forme",
		icon: RemoveFormatting,
		group: "format",
		run: ({ editor }) => editor.chain().focus().unsetAllMarks().clearNodes().run(),
	},

	/* ---- Couleur ---------------------------------------------------------- */
	{
		id: "color",
		label: "Couleur du texte",
		icon: Palette,
		group: "couleur",
		requires: "typography",
		run: ({ ui }) => ui.color(),
		isActive: (e) => e.isActive("textStyle"),
	},

	/* ---- Alignement ------------------------------------------------------- */
	{
		id: "align-left",
		label: "Aligner à gauche",
		icon: AlignLeft,
		group: "alignement",
		requires: "typography",
		run: ({ editor }) => editor.chain().focus().setTextAlign("left").run(),
		isActive: (e) => e.isActive({ textAlign: "left" }),
	},
	{
		id: "align-center",
		label: "Centrer",
		icon: AlignCenter,
		group: "alignement",
		requires: "typography",
		run: ({ editor }) => editor.chain().focus().setTextAlign("center").run(),
		isActive: (e) => e.isActive({ textAlign: "center" }),
	},
	{
		id: "align-right",
		label: "Aligner à droite",
		icon: AlignRight,
		group: "alignement",
		requires: "typography",
		run: ({ editor }) => editor.chain().focus().setTextAlign("right").run(),
		isActive: (e) => e.isActive({ textAlign: "right" }),
	},
	{
		id: "align-justify",
		label: "Justifier",
		icon: AlignJustify,
		group: "alignement",
		requires: "typography",
		run: ({ editor }) => editor.chain().focus().setTextAlign("justify").run(),
		isActive: (e) => e.isActive({ textAlign: "justify" }),
	},

	/* ---- Listes & blocs --------------------------------------------------- */
	{
		id: "bullet-list",
		label: "Liste à puces",
		icon: List,
		group: "listes",
		shortcut: "Ctrl+Maj+8",
		insert: true,
		essential: true,
		run: ({ editor }) => editor.chain().focus().toggleBulletList().run(),
		isActive: (e) => e.isActive("bulletList"),
	},
	{
		id: "ordered-list",
		label: "Liste numérotée",
		icon: ListOrdered,
		group: "listes",
		shortcut: "Ctrl+Maj+7",
		insert: true,
		run: ({ editor }) => editor.chain().focus().toggleOrderedList().run(),
		isActive: (e) => e.isActive("orderedList"),
	},
	{
		id: "blockquote",
		label: "Citation",
		icon: Quote,
		group: "listes",
		insert: true,
		run: ({ editor }) => editor.chain().focus().toggleBlockquote().run(),
		isActive: (e) => e.isActive("blockquote"),
	},
	{
		id: "code-block",
		label: "Bloc de code",
		icon: Code2,
		group: "listes",
		requires: "code",
		insert: true,
		run: ({ editor }) => editor.chain().focus().toggleCodeBlock().run(),
		isActive: (e) => e.isActive("codeBlock"),
	},
	{
		id: "hr",
		label: "Séparateur",
		icon: Minus,
		group: "listes",
		insert: true,
		hint: "Trait horizontal",
		run: ({ editor }) => editor.chain().focus().setHorizontalRule().run(),
	},

	/* ---- Liens & médias --------------------------------------------------- */
	{
		id: "link",
		label: "Lien",
		icon: Link2,
		group: "media",
		shortcut: "Ctrl+K",
		essential: true,
		run: ({ ui }) => ui.link(),
		isActive: (e) => e.isActive("link"),
	},
	{
		id: "unlink",
		label: "Retirer le lien",
		icon: Link2Off,
		group: "media",
		run: ({ editor }) => editor.chain().focus().extendMarkRange("link").unsetLink().run(),
		isDisabled: (e) => !e.isActive("link"),
	},
	{
		id: "image",
		label: "Image",
		icon: ImagePlus,
		group: "media",
		requires: "media",
		hint: "Depuis l'appareil ou une URL",
		insert: true,
		essential: true,
		run: ({ ui }) => ui.image(),
	},
	{
		id: "gallery",
		label: "Galerie",
		icon: Images,
		group: "media",
		requires: "media",
		hint: "Plusieurs images en grille",
		insert: true,
		run: ({ ui }) => ui.gallery(),
	},
	{
		id: "banner",
		label: "Bannière",
		icon: PanelTop,
		group: "media",
		requires: "media",
		hint: "Image de fond avec titre",
		insert: true,
		run: ({ ui }) => ui.banner(),
	},
	{
		id: "embed",
		label: "Vidéo",
		icon: MonitorPlay,
		group: "media",
		requires: "media",
		hint: "YouTube ou lecteur intégré",
		insert: true,
		run: ({ ui }) => ui.embed(),
	},
	{
		id: "table",
		label: "Tableau",
		icon: TableIcon,
		group: "media",
		requires: "tables",
		hint: "Grille de données",
		insert: true,
		run: ({ editor, ui }) => {
			if (editor.isActive("table")) ui.table();
			else editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
		},
		isActive: (e) => e.isActive("table"),
	},
	{
		id: "table-delete",
		label: "Supprimer le tableau",
		icon: Trash2,
		group: "media",
		requires: "tables",
		run: ({ editor }) => editor.chain().focus().deleteTable().run(),
		isDisabled: (e) => !e.isActive("table"),
	},

	/* ---- Mise en page ----------------------------------------------------- */
	...CALLOUTS.map<EditorAction>(({ kind, label }) => ({
		id: `callout-${kind}`,
		label,
		icon: Info,
		group: "mise-en-page",
		requires: "layout",
		insert: true,
		hint: "Bloc coloré qui attire l'œil",
		keywords: ["encadré", "callout", "alerte", kind],
		run: ({ editor }) => editor.chain().focus().toggleCallout(kind).run(),
		isActive: (e) => e.isActive("callout", { kind }),
	})),
	{
		id: "columns-2",
		label: "2 colonnes",
		icon: Columns2,
		group: "mise-en-page",
		requires: "layout",
		insert: true,
		run: ({ editor }) => editor.chain().focus().insertColumns(2).run(),
	},
	{
		id: "columns-3",
		label: "3 colonnes",
		icon: Columns3,
		group: "mise-en-page",
		requires: "layout",
		insert: true,
		run: ({ editor }) => editor.chain().focus().insertColumns(3).run(),
	},
	{
		id: "details",
		label: "Section repliable",
		icon: ListTree,
		group: "mise-en-page",
		requires: "layout",
		insert: true,
		hint: "Catégorie au nom libre, repliée sur la page",
		keywords: ["accordéon", "details", "catégorie", "spoiler"],
		run: ({ editor }) => editor.chain().focus().insertDetailsSection("Nouvelle section").run(),
	},
	{
		id: "spacer",
		label: "Espace",
		icon: SeparatorHorizontal,
		group: "mise-en-page",
		requires: "layout",
		insert: true,
		hint: "Respiration verticale",
		run: ({ editor }) => editor.chain().focus().insertSpacer(48).run(),
	},

	/* ---- Univers ---------------------------------------------------------- */
	{
		id: "ki",
		label: "Niveau de puissance",
		icon: Gauge,
		group: "univers",
		requires: "universe",
		insert: true,
		hint: "Badge Ki avec son contexte",
		keywords: ["ki", "puissance", "power level"],
		run: ({ ui }) => ui.ki(),
	},
	{
		id: "action-button",
		label: "Bouton",
		icon: MousePointerClick,
		group: "univers",
		requires: "universe",
		insert: true,
		hint: "Lien mis en avant",
		run: ({ ui }) => ui.button(),
	},

	/* ---- Outils ----------------------------------------------------------- */
	{
		id: "find",
		label: "Rechercher / remplacer",
		icon: Search,
		group: "outils",
		shortcut: "Ctrl+F",
		run: ({ ui }) => ui.find(),
	},
	{
		id: "source",
		label: "Code source",
		icon: FileCode2,
		group: "outils",
		run: ({ ui }) => ui.source(),
	},
	{
		id: "preview",
		label: "Aperçu",
		icon: Eye,
		group: "outils",
		run: ({ ui }) => ui.preview(),
	},
	{
		id: "fullscreen",
		label: "Plein écran",
		icon: Maximize2,
		group: "outils",
		shortcut: "F11",
		run: ({ ui }) => ui.fullscreen(),
	},
	{
		id: "shortcuts",
		label: "Raccourcis clavier",
		icon: Keyboard,
		group: "outils",
		shortcut: "Ctrl+/",
		run: ({ ui }) => ui.shortcuts(),
	},
	{
		id: "text-style-reset",
		label: "Réinitialiser la couleur",
		icon: Baseline,
		group: "couleur",
		requires: "typography",
		run: ({ editor }) => editor.chain().focus().unsetColor().unsetHighlight().run(),
	},
];

/** Actions réellement disponibles pour un preset donné. */
export function actionsFor(preset: PresetName): EditorAction[] {
	const p = EDITOR_PRESETS[preset];
	return ALL_ACTIONS.filter((a) => {
		switch (a.requires) {
			case "headings":
				return p.headings.length > 0;
			case "typography":
				return p.typography;
			case "media":
				return p.media;
			case "layout":
				return p.layout;
			case "tables":
				return p.tables;
			case "code":
				return p.code;
			case "universe":
				return p.universe;
			default:
				return true;
		}
	});
}

/** Sous-ensemble proposé dans le menu « / » et la feuille d'insertion mobile. */
export function insertActionsFor(preset: PresetName): EditorAction[] {
	return actionsFor(preset).filter((a) => a.insert);
}

/** Recherche floue simple (libellé + mots-clés + groupe). */
export function matchAction(action: EditorAction, query: string): boolean {
	const q = query
		.trim()
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");
	if (!q) return true;
	const hay = [
		action.label,
		action.hint ?? "",
		GROUP_LABEL[action.group],
		...(action.keywords ?? []),
	]
		.join(" ")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");
	return q.split(/\s+/).every((token) => hay.includes(token));
}
