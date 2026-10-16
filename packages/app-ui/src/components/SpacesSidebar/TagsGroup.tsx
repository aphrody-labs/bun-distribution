import { CaretRight, Plus, Tag as TagIcon, Trash } from "@phosphor-icons/react";
import type {
  SearchTagsInput,
  SearchTagsOutput,
  Tag,
} from "@aphrody/drive-client";
import { clsx } from "clsx";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { usePlatform } from "../../contexts/PlatformContext";
import {
  useLibraryMutation,
  useNormalizedQuery,
} from "../../contexts/SpacedriveContext";
import { useContextMenu } from "../../hooks/useContextMenu";
import { useRefetchTagQueries } from "../../hooks/useRefetchTagQueries";
import { useExplorer } from "../../routes/explorer/context";
import { GroupHeader } from "./GroupHeader";

interface TagsGroupProps {
  isCollapsed: boolean;
  onToggle: () => void;
  sortableAttributes?: any;
  sortableListeners?: any;
}

interface TagItemProps {
  tag: Tag;
  depth?: number;
}

function TagItem({ tag, depth = 0 }: TagItemProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const platform = usePlatform();
  const { loadPreferencesForSpaceItem } = useExplorer();
  const [isExpanded, setIsExpanded] = useState(false);
  const refetchTagQueries = useRefetchTagQueries();
  const deleteTag = useLibraryMutation("tags.delete", {
    onSuccess: refetchTagQueries,
  });

  const children: Tag[] = [];
  const hasChildren = children.length > 0;
  const isActive = location.pathname === `/tag/${tag.id}`;

  const handleClick = () => {
    loadPreferencesForSpaceItem(`tag:${tag.id}`);
    navigate(`/tag/${tag.id}`);
  };

  const contextMenu = useContextMenu({
    items: [
      {
        icon: Trash,
        label: "Delete Tag",
        variant: "danger",
        onClick: () => {
          platform.confirm(
            `Delete tag "${tag.canonical_name || tag.display_name || "this tag"}"? This will remove it from all files.`,
            async (confirmed) => {
              if (!confirmed) return;
              try {
                await deleteTag.mutateAsync({ tag_id: tag.id });
                if (isActive) {
                  navigate("/");
                }
              } catch (err) {
                console.error("Failed to delete tag:", err);
              }
            },
          );
        },
      },
    ],
  });

  return (
    <div>
      <button
        onClick={handleClick}
        onContextMenu={contextMenu.show}
        className={clsx(
          "flex w-full cursor-pointer items-center gap-2 rounded-small px-2 py-1.5 text-label-large font-medium transition-colors",
          isActive
            ? "bg-secondary-container/30 text-on-surface"
            : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
          tag.privacy_level === "Archive" && "opacity-50",
          tag.privacy_level === "Hidden" && "opacity-25",
        )}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        {hasChildren && (
          <CaretRight
            size={10}
            weight="bold"
            className={clsx(
              "flex-shrink-0 transition-transform",
              isExpanded && "rotate-90",
            )}
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
          />
        )}

        {tag.icon ? (
          <TagIcon
            size={16}
            weight="bold"
            style={{ color: tag.color || "#3B82F6" }}
          />
        ) : (
          <span
            className="size-2 flex-shrink-0 rounded-full"
            style={{ backgroundColor: tag.color || "#3B82F6" }}
          />
        )}

        <span className="flex-1 truncate text-left">{tag.canonical_name}</span>
      </button>

      {isExpanded &&
        children.map((child) => (
          <TagItem key={child.id} tag={child} depth={depth + 1} />
        ))}
    </div>
  );
}

export function TagsGroup({
  isCollapsed,
  onToggle,
  sortableAttributes,
  sortableListeners,
}: TagsGroupProps) {
  const navigate = useNavigate();
  const { loadPreferencesForSpaceItem } = useExplorer();
  const [isCreating, setIsCreating] = useState(false);
  const [newTagName, setNewTagName] = useState("");

  const refetchTagQueries = useRefetchTagQueries();
  const createTag = useLibraryMutation("tags.create", {
    onSuccess: refetchTagQueries,
  });

  const { data: tags = [], isLoading } = useNormalizedQuery<
    SearchTagsInput,
    SearchTagsOutput,
    Tag[]
  >({
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

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;

    try {
      const result = await createTag.mutateAsync({
        canonical_name: newTagName.trim(),
        display_name: null,
        formal_name: null,
        abbreviation: null,
        aliases: [],
        namespace: null,
        tag_type: null,
        color: `#${Math.floor(Math.random() * 16777215)
          .toString(16)
          .padStart(6, "0")}`,
        icon: null,
        description: null,
        is_organizational_anchor: null,
        privacy_level: null,
        search_weight: null,
        attributes: null,
        apply_to: null,
      });

      if (result?.tag_id) {
        loadPreferencesForSpaceItem(`tag:${result.tag_id}`);
        navigate(`/tag/${result.tag_id}`);
      }

      setNewTagName("");
      setIsCreating(false);
    } catch (err) {
      console.error("Failed to create tag:", err);
    }
  };

  return (
    <div>
      <GroupHeader
        label="Tags"
        isCollapsed={isCollapsed}
        onToggle={onToggle}
        sortableAttributes={sortableAttributes}
        sortableListeners={sortableListeners}
        rightComponent={
          tags.length > 0 && (
            <span className="text-outline ml-auto">{tags.length}</span>
          )
        }
      />

      {!isCollapsed && (
        <div className="space-y-0.5">
          {isLoading ? (
            <div className="text-outline px-2 py-1 text-body-small">
              Loading...
            </div>
          ) : tags.length === 0 ? (
            <div className="text-outline px-2 py-1 text-body-small">
              No tags: create one to group files
            </div>
          ) : (
            tags.map((tag: Tag) => <TagItem key={tag.id} tag={tag} />)
          )}

          {isCreating ? (
            <div className="px-2 py-1.5">
              <input
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCreateTag();
                  } else if (e.key === "Escape") {
                    setIsCreating(false);
                    setNewTagName("");
                  }
                }}
                onBlur={() => {
                  if (!newTagName.trim()) {
                    setIsCreating(false);
                  }
                }}
                placeholder="Tag name..."

                className="bg-surface-container border-outline-variant text-on-surface placeholder:text-outline focus:border-primary w-full rounded-small border px-2 py-1 text-body-small outline-none"
              />
            </div>
          ) : (
            <button
              onClick={() => setIsCreating(true)}
              className="text-on-surface-variant hover:bg-surface-container hover:text-on-surface flex w-full cursor-pointer items-center gap-2 rounded-small px-2 py-1.5 text-label-medium font-medium transition-colors"
            >
              <Plus size={12} weight="bold" />
              <span>New tag</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
