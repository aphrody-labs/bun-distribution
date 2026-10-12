import { CaretRight, DotsSixVertical, PencilSimple, Trash } from "@phosphor-icons/react";
import { clsx } from "clsx";
import { useState } from "react";
import { useContextMenu } from "../../hooks/useContextMenu";
import { useLibraryMutation } from "@aphrody/drive-client";
import type { SpaceGroup } from "@aphrody/drive-client";
import { useI18n } from "../../i18n";

interface GroupHeaderProps {
  label: string;
  isCollapsed: boolean;
  onToggle: () => void;
  rightComponent?: React.ReactNode;
  sortableAttributes?: any;
  sortableListeners?: any;
  group?: SpaceGroup;
  allowCustomization?: boolean;
}

export function GroupHeader({
  label,
  isCollapsed,
  onToggle,
  rightComponent,
  sortableAttributes,
  sortableListeners,
  group,
  allowCustomization = false,
}: GroupHeaderProps) {
  const { t } = useI18n();
  const hasSortable = sortableAttributes && sortableListeners;
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(label);

  const displayLabel = (() => {
    const l = label.toLowerCase();
    if (l === "devices") return t("groups.devices", "Appareils");
    if (l === "locations") return t("groups.locations", "Emplacements");
    if (l === "volumes") return t("groups.volumes", "Volumes");
    if (l === "tags") return t("groups.tags", "Balises");
    if (l === "sources") return t("groups.sources", "Sources & Distant");
    return label;
  })();

  const updateGroup = useLibraryMutation("spaces.update_group");
  const deleteGroup = useLibraryMutation("spaces.delete_group");

  const handleRename = async () => {
    if (!group || !newName.trim() || newName === label) {
      setIsRenaming(false);
      setNewName(label);
      return;
    }

    try {
      await updateGroup.mutateAsync({
        group_id: group.id,
        name: newName.trim(),
        is_collapsed: null,
      });
      setIsRenaming(false);
    } catch (error) {
      console.error("Failed to rename group:", error);
      setNewName(label);
      setIsRenaming(false);
    }
  };

  const handleDelete = async () => {
    if (!group) return;

    try {
      await deleteGroup.mutateAsync({ group_id: group.id });
    } catch (error) {
      console.error("Failed to delete group:", error);
    }
  };

  const contextMenu = useContextMenu({
    items: [
      {
        icon: PencilSimple,
        label: "Rename group",
        onClick: () => {
          setNewName(label);
          setIsRenaming(true);
        },
        condition: () => allowCustomization,
      },
      { type: "separator" },
      {
        icon: Trash,
        label: "Delete group",
        onClick: handleDelete,
        variant: "danger" as const,
        condition: () => allowCustomization,
      },
    ],
  });

  const handleContextMenu = async (e: React.MouseEvent) => {
    if (!allowCustomization) return;
    e.preventDefault();
    e.stopPropagation();
    await contextMenu.show(e);
  };

  return (
    <div className="mb-1 flex w-full items-center gap-1 px-1">
      {/* Drag Handle - Only show if sortable */}
      {hasSortable && (
        <div
          {...sortableAttributes}
          {...sortableListeners}
          className="cursor-grab active:cursor-grabbing py-2 px-0.5 -ml-1 text-sidebar-inkFaint hover:text-on-surface transition-colors"
        >
          <DotsSixVertical size={12} weight="bold" />
        </div>
      )}

      {/* Collapsible Button or Rename Input */}
      {isRenaming ? (
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleRename();
            } else if (e.key === "Escape") {
              setIsRenaming(false);
              setNewName(label);
            }
          }}
          onBlur={handleRename}

          className="flex-1 px-2 py-1 text-label-small font-semibold tracking-wider rounded-small bg-surface-container border border-outline-variant text-on-surface placeholder:text-outline outline-none focus:border-primary"
        />
      ) : (
        <button
          onClick={onToggle}
          onContextMenu={handleContextMenu}
          className="flex-1 flex items-center gap-2 py-2 text-label-small font-semibold tracking-wider opacity-60 text-outline hover:text-on-surface transition-colors min-h-[32px]"
        >
          <CaretRight
            className={clsx("transition-transform", !isCollapsed && "rotate-90")}
            size={10}
            weight="bold"
          />
          <span>{displayLabel}</span>
          {rightComponent}
        </button>
      )}
    </div>
  );
}
