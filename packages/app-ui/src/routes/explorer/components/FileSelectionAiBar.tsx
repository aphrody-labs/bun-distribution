// SPDX-License-Identifier: Apache-2.0
import { AnimatePresence, motion } from "motion/react";
import { m3Durations, m3Easings } from "@aphrody/m3-motion";
import { Button, Icon } from "@aphrody/m3-primitives";
import { useSelection } from "../SelectionContext";
import { useExplorer } from "../context";
import { useAskAphrody } from "../hooks/useAskAphrody";

export function FileSelectionAiBar() {
  const { selectedFiles, clearSelection } = useSelection();
  const { tagModeActive } = useExplorer();
  const askAphrody = useAskAphrody();

  if (selectedFiles.length === 0 || tagModeActive) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.section
        initial={{ y: 80, opacity: 0, scale: 0.96 }}
        animate={{
          y: 0,
          opacity: 1,
          scale: 1,
          transition: {
            duration: m3Durations.medium2,
            ease: m3Easings.emphasizedDecelerate,
          },
        }}
        exit={{
          y: 80,
          opacity: 0,
          scale: 0.96,
          transition: {
            duration: m3Durations.short4,
            ease: m3Easings.emphasizedAccelerate,
          },
        }}
        className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4"
        aria-label="Actions contextuelles sur les fichiers sélectionnés"
      >
        <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-full border border-outline-variant/60 bg-surface-container-high/95 p-1.5 pl-4 pr-2 shadow-md3-3 backdrop-blur-md">
          {/* Selection counter badge */}
          <span className="text-label-large font-medium text-on-surface whitespace-nowrap pr-1 select-none">
            {selectedFiles.length}{" "}
            {selectedFiles.length === 1 ? "élément" : "éléments"}
          </span>

          <div
            className="h-5 w-px bg-outline-variant/60 shrink-0"
            aria-hidden="true"
          />

          {/* Demander à Aphrody */}
          <Button
            variant="filled"
            size="sm"
            onClick={() => askAphrody(selectedFiles)}
            className="min-h-[44px] px-3.5 text-label-large font-medium"
            title="Ouvrir dans Chat avec le contexte du fichier"
          >
            <Icon name="auto_awesome" size={20} />
            <span>Demander à Aphrody</span>
          </Button>

          {/* Clear Selection button */}
          <button
            type="button"
            onClick={clearSelection}
            title="Désélectionner tout"
            aria-label="Désélectionner tout"
            className="flex size-9 min-h-[36px] min-w-[36px] items-center justify-center rounded-full text-on-surface-variant hover:bg-on-surface/8 hover:text-on-surface transition-colors active:scale-95"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      </motion.section>
    </AnimatePresence>
  );
}
