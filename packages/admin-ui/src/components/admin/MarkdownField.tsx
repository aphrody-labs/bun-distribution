"use client";

/**
 * Champ markdown des écrans d'administration.
 *
 * Ce n'est plus qu'une **façade** sur le module d'édition
 * (`components/editor`) : même barre d'outils, mêmes blocs, même autosauvegarde
 * et même comportement mobile que l'éditeur d'articles ou de pages wiki. Le
 * contenu reste du markdown (+ HTML libre), exactement ce que la base stocke et
 * ce que `WikiMarkdown` rend côté public.
 *
 * L'API (`value` / `onChange` / `subdir`) est conservée telle quelle : tous les
 * appelants historiques (éditeur générique de tables, studio wiki, éditeur de
 * home, panneau de sections) fonctionnent sans changement.
 */
import { ShenronEditor } from "@/components/editor";
import { WikiMarkdown } from "@/components/wiki/WikiMarkdown";

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** Sous-dossier d'upload des images (namespace côté bot). */
  subdir?: string;
  /**
   * Conservé pour compatibilité. L'aperçu est désormais un **onglet** du module
   * (côte à côte illisible au doigt) ; il est toujours disponible.
   */
  preview?: boolean;
  /** Clé d'autosauvegarde (`wiki:<table>:<ligne>:<colonne>`…). */
  autosaveKey?: string;
  placeholder?: string;
  minHeight?: string;
  /** Preset du module : `wiki` par défaut, `section` pour un bloc court. */
  preset?: "wiki" | "section" | "note";
}

export function MarkdownField({
  value,
  onChange,
  subdir = "inline",
  autosaveKey,
  placeholder = "Décrivez l'entité… tapez « / » pour insérer un bloc, glissez une image directement dans le texte.",
  minHeight = "16rem",
  preset = "wiki",
}: Props) {
  return (
    <ShenronEditor
      format="markdown"
      preset={preset}
      value={value}
      onChangeMarkdown={onChange}
      uploadSubdir={subdir}
      autosaveKey={autosaveKey}
      placeholder={placeholder}
      minHeight={minHeight}
      maxHeight="60vh"
      ariaLabel="Contenu markdown"
      renderPreview={source =>
        source.trim() ? (
          <WikiMarkdown body={source} />
        ) : (
          <p className="italic text-white/45">L&apos;aperçu s&apos;affiche ici…</p>
        )
      }
    />
  );
}
