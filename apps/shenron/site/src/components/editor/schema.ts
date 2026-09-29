/**
 * Schéma unique du module d'édition — **une seule** source de vérité pour la
 * saisie (navigateur), le rendu HTML des articles (serveur) et le pont markdown
 * du wiki.
 *
 * Règle d'or : une extension présente à la saisie mais absente au rendu fait
 * disparaître du contenu déjà publié. Tout passe donc par `buildExtensions()`.
 *
 * Module **client-safe** (aucun React, aucune API navigateur au niveau module) :
 * importable depuis un Server Component comme depuis un `"use client"`.
 */
import { Image } from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { Youtube } from "@tiptap/extension-youtube";
import { Highlight } from "@tiptap/extension-highlight";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { StarterKit } from "@tiptap/starter-kit";
import type { Extensions } from "@tiptap/core";

import {
	Banner,
	Callout,
	Column,
	Columns,
	DetailsSection,
	DetailsSummary,
	Embed,
	Figure,
	Gallery,
	Spacer,
} from "./nodes/blocks";
import { HtmlBlock, HtmlContainer } from "./nodes/raw";
import { ActionButton, KiBadge } from "./nodes/inline";

/**
 * Protocoles autorisés dans les liens. Tout le reste (`javascript:`, `data:`…)
 * est rejeté par Tiptap à la saisie ET au collage — première ligne de défense
 * contre un XSS stocké, même quand l'édition est réservée aux admins.
 */
const ALLOWED_LINK_PROTOCOLS = ["http", "https", "mailto"];

/** Jeux de fonctionnalités par usage. */
export type PresetName = "article" | "wiki" | "section" | "comment" | "note";

export type PresetConfig = {
	/** Titres autorisés dans le corps (jamais `h1` : c'est le titre de la page). */
	headings: number[];
	/** Mise en forme avancée (surlignage, indice/exposant, couleur, alignement). */
	typography: boolean;
	/** Médias : image, figure, galerie, bannière, vidéo. */
	media: boolean;
	/** Blocs de mise en page : encadrés, colonnes, sections repliables, espaces. */
	layout: boolean;
	/** Tableaux. */
	tables: boolean;
	/** Blocs de code. */
	code: boolean;
	/** Nœuds propres à l'univers : badge Ki, bouton d'action. */
	universe: boolean;
	/** Conservation du HTML libre écrit à la main (wiki). */
	rawHtml: boolean;
};

export const EDITOR_PRESETS: Record<PresetName, PresetConfig> = {
	// Articles du journal : rédaction longue, riche, avec mise en page.
	article: {
		headings: [2, 3, 4],
		typography: true,
		media: true,
		layout: true,
		tables: true,
		code: true,
		universe: true,
		rawHtml: false,
	},
	// Pages et fiches wiki : tout, HTML libre compris.
	wiki: {
		headings: [2, 3, 4],
		typography: true,
		media: true,
		layout: true,
		tables: true,
		code: true,
		universe: true,
		rawHtml: true,
	},
	// Sections CMS d'une fiche (bloc court mais mis en page).
	section: {
		headings: [3, 4],
		typography: true,
		media: true,
		layout: true,
		tables: true,
		code: false,
		universe: true,
		rawHtml: true,
	},
	// Commentaires publics : mise en forme sobre, aucun média, aucun HTML.
	comment: {
		headings: [],
		typography: false,
		media: false,
		layout: false,
		tables: false,
		code: true,
		universe: false,
		rawHtml: false,
	},
	// Notes internes / champs courts d'admin.
	note: {
		headings: [3],
		typography: true,
		media: false,
		layout: false,
		tables: false,
		code: true,
		universe: false,
		rawHtml: false,
	},
};

/**
 * Construit la liste d'extensions d'un preset. Déterministe et sans effet de
 * bord : le même preset donne exactement le même schéma des deux côtés.
 */
export function buildExtensions(preset: PresetName = "wiki"): Extensions {
	const p = EDITOR_PRESETS[preset];
	const ext: Extensions = [
		StarterKit.configure({
			// Le schéma accepte TOUS les niveaux : une page wiki historique commence
			// souvent par `# Titre`, et un niveau absent du schéma serait aplati en
			// paragraphe au premier enregistrement. Ce que le preset restreint, ce
			// sont les niveaux **proposés** dans la barre d'outils (`p.headings`).
			heading: p.headings.length ? { levels: [1, 2, 3, 4, 5, 6] } : false,
			codeBlock: p.code ? { languageClassPrefix: "language-" } : false,
			code: p.code ? undefined : false,
			link: {
				openOnClick: false, // en édition, cliquer un lien place le curseur
				autolink: true,
				defaultProtocol: "https",
				protocols: ALLOWED_LINK_PROTOCOLS,
				HTMLAttributes: {
					// Les liens sortants s'ouvrent ailleurs ; `noopener` neutralise
					// l'accès à `window.opener` depuis la page cible.
					rel: "noopener noreferrer",
					target: "_blank",
				},
			},
			// `TrailingNode` (fourni par StarterKit) garantit un paragraphe vide en
			// fin de document : sans lui, impossible d'écrire après une image ou un
			// tableau terminal — piège classique signalé par les rédacteurs.
		}),
	];

	if (p.typography) {
		ext.push(
			Highlight.configure({ multicolor: true }),
			Subscript,
			Superscript,
			TextAlign.configure({ types: ["heading", "paragraph"] }),
			TextStyleKit.configure({ fontSize: {}, color: {}, backgroundColor: {}, lineHeight: {} })
		);
	}

	if (p.media) {
		ext.push(
			Image.configure({
				allowBase64: false, // une image collée passe par l'upload, pas par le HTML
				HTMLAttributes: { loading: "lazy", decoding: "async" },
			}),
			Figure,
			Gallery,
			Banner,
			Embed,
			Youtube.configure({
				nocookie: true, // youtube-nocookie.com : pas de cookie tiers avant lecture
				modestBranding: true,
				HTMLAttributes: { class: "ed-embed-video" },
			})
		);
	}

	if (p.layout) ext.push(Callout, Columns, Column, DetailsSection, DetailsSummary, Spacer);
	if (p.tables)
		ext.push(TableKit.configure({ table: { resizable: true, allowTableNodeSelection: true } }));
	if (p.universe) ext.push(KiBadge, ActionButton);
	// Les filets HTML passent en dernier : leurs règles de parsing sont de faible
	// priorité, ils ne récupèrent que ce qu'aucun nœud connu n'a réclamé.
	if (p.rawHtml) ext.push(HtmlContainer, HtmlBlock);

	return ext;
}

/** Document vide — valeur initiale d'un nouveau contenu. */
export const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] } as const;
