import { motion, AnimatePresence } from "motion/react";
import { m3Durations, m3Easings } from "@aphrody/m3-motion";
import { clsx } from "clsx";
import { Button, Icon, m3FocusRing, toast } from "@aphrody/m3-primitives";
import { useNormalizedQuery, useLibraryMutation } from "../../contexts/SpacedriveContext";
import { useSelection } from "./SelectionContext";
import { useKeybind } from "../../hooks/useKeybind";
import type { SearchTagsInput, SearchTagsOutput, Tag } from "@aphrody/drive-client";

interface TagAssignmentModeProps {
  isActive: boolean;
  onExit: () => void;
}

/**
 * Tag Assignment Mode - Quick keyboard-driven tagging
 *
 * Features:
 * - Toggle tags with number keys (1-9, 0)
 * - Switch palettes with Cmd+Shift+[1-9]
 * - Visual feedback for applied tags
 * - Works on selected files
 */
export function TagAssignmentMode({ isActive, onExit }: TagAssignmentModeProps) {
  const { selectedFiles } = useSelection();
  const applyTag = useLibraryMutation("tags.apply");

  // The keyboard palette is the first 10 available tags.
  const { data: allTags = [] } = useNormalizedQuery<SearchTagsInput, SearchTagsOutput, Tag[]>({
    query: "tags.search",
    input: {
      query: "",
      namespace: null,
      tag_type: null,
      include_archived: null,
      limit: null,
      resolve_ambiguous: null,
      context_tag_ids: null,
    },
    resourceType: "tag",
    select: (data) => data.tags.map((result) => result.tag),
  });

  const paletteTags = allTags.slice(0, 10);

  const handleToggleTag = async (index: number) => {
    const tag = paletteTags[index];
    if (!tag || selectedFiles.length === 0) return;

    // Get content IDs from selected files (filter out files without content identity)
    const contentIds = selectedFiles
      .map((f) => f.content_identity?.uuid)
      .filter((id): id is string => id != null);

    if (contentIds.length === 0) {
      toast.error("These files need to be indexed before they can be tagged");
      return;
    }

    try {
      await applyTag.mutateAsync({
        targets: { type: "Content", ids: contentIds },
        tag_ids: [tag.id],
        source: null,
        confidence: null,
        applied_context: null,
        instance_attributes: null,
      });
    } catch (err) {
      console.error("Failed to apply tag:", err);
      toast.error(`Failed to apply tag: ${err}`);
    }
  };

  // Keyboard shortcuts using keybind registry
  useKeybind("explorer.exitTagMode", onExit, { enabled: isActive });
  useKeybind("explorer.toggleTag1", () => handleToggleTag(0), { enabled: isActive });
  useKeybind("explorer.toggleTag2", () => handleToggleTag(1), { enabled: isActive });
  useKeybind("explorer.toggleTag3", () => handleToggleTag(2), { enabled: isActive });
  useKeybind("explorer.toggleTag4", () => handleToggleTag(3), { enabled: isActive });
  useKeybind("explorer.toggleTag5", () => handleToggleTag(4), { enabled: isActive });
  useKeybind("explorer.toggleTag6", () => handleToggleTag(5), { enabled: isActive });
  useKeybind("explorer.toggleTag7", () => handleToggleTag(6), { enabled: isActive });
  useKeybind("explorer.toggleTag8", () => handleToggleTag(7), { enabled: isActive });
  useKeybind("explorer.toggleTag9", () => handleToggleTag(8), { enabled: isActive });
  useKeybind("explorer.toggleTag10", () => handleToggleTag(9), { enabled: isActive });

  // Check if a tag is active (all selected files have it)
  const isTagActive = (tag: Tag) => {
    if (selectedFiles.length === 0) return false;
    return selectedFiles.every((file) => file.tags?.some((t) => t.id === tag.id));
  };

  if (!isActive) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{
          y: 0,
          opacity: 1,
          transition: { duration: m3Durations.medium2, ease: m3Easings.emphasizedDecelerate },
        }}
        exit={{
          y: 100,
          opacity: 0,
          transition: { duration: m3Durations.short4, ease: m3Easings.emphasizedAccelerate },
        }}
        className="absolute bottom-2 left-1 right-1 z-50"
      >
        <div className="bg-surface-container-high rounded-large px-4 py-3 shadow-md3-3">
          <div className="flex items-center gap-3">
            {/* Mode Label */}
            <div className="flex items-center gap-2">
              <Icon name="label" size={20} filled className="text-primary" />
              <span className="text-title-small text-on-surface">Tag mode</span>
              {selectedFiles.length > 0 && (
                <span className="text-body-small text-on-surface-variant">
                  {selectedFiles.length} {selectedFiles.length === 1 ? "item" : "items"}
                </span>
              )}
            </div>

            {/* Palette Tags */}
            <div className="flex gap-1.5 flex-1">
              {paletteTags.map((tag, index) => {
                const active = isTagActive(tag);
                const number = index === 9 ? 0 : index + 1;

                return (
                  <button
                    type="button"
                    aria-pressed={active}
                    key={tag.id}
                    onClick={() => handleToggleTag(index)}
                    className={clsx(
                      "inline-flex h-8 items-center gap-2 rounded-small px-2.5 text-label-large transition-[transform,box-shadow] duration-200 ease-standard",
                      m3FocusRing,
                      active ? "shadow-md3-1 scale-105" : "hover:scale-105",
                    )}
                    style={{
                      backgroundColor: active
                        ? `${tag.color || "#3B82F6"}40`
                        : `${tag.color || "#3B82F6"}20`,
                      color: tag.color || "#3B82F6",
                    }}
                  >
                    {/* Keyboard Number */}
                    <kbd className="px-1 py-0.5 text-label-small rounded-extra-small bg-on-surface/12 text-on-surface min-w-[16px] text-center">
                      {number}
                    </kbd>

                    {/* Tag Name */}
                    <span className="truncate max-w-[120px]">{tag.canonical_name}</span>

                    {/* Active Checkmark */}
                    {active && <Icon name="check" size={16} />}
                  </button>
                );
              })}
            </div>

            {/* Exit Button */}
            <Button aria-label="Done" title="Done" size="sm" variant="filled" onClick={onExit}>
              <Icon name="check" size={18} />
            </Button>
          </div>

          {/* Help Text */}
          {selectedFiles.length === 0 && (
            <div className="mt-2 text-body-small text-on-surface-variant text-center">
              Select files to start tagging • Press 1-9/0 to toggle tags • Esc to exit
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
