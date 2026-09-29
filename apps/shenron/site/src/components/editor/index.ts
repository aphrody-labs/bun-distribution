/**
 * Module d'édition du site — point d'entrée unique.
 *
 * Tout ce qui saisit du texte sur dragonballfr.com passe par ici :
 *   - `ShenronEditor` : éditeur riche (articles, wiki, sections CMS, home) ;
 *   - `PlainField`    : texte simple (commentaires, signalements, avis, admin) —
 *     à importer **directement** depuis `@/components/editor/PlainField` hors des
 *     écrans d'administration : ce point d'entrée tire l'éditeur riche
 *     (ProseMirror, CodeMirror, feuilles de style), qui n'a rien à faire dans le
 *     paquet d'une page de commentaires ;
 *   - `buildExtensions` / `serializeMarkdown` / `parseMarkdown` : le schéma et le
 *     pont markdown, partagés avec le rendu serveur.
 */
export { ShenronEditor } from "./Editor";
;
;
;
;
;
;
;
;
;
