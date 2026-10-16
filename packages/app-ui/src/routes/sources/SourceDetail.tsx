import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useLibraryQuery,
  useLibraryMutation,
} from "../../contexts/SpacedriveContext";
import { useTabManager } from "../../components/TabManager/useTabManager";
import { TopBarPortal, TopBarItem } from "../../TopBar";
import {
  Button,
  CircleButton,
  Icon,
  Popover,
  m3FocusRing,
  usePopover,
} from "@aphrody/m3-primitives";
import { clsx } from "clsx";

/** M3 menu item, dense (desktop density step). */
const menuItemClassName = clsx(
  "flex h-10 w-full items-center gap-3 px-3 text-left text-label-large transition-colors duration-200 ease-standard",
  "hover:bg-on-surface/8 focus-visible:bg-on-surface/10 active:bg-on-surface/10",
  "disabled:pointer-events-none disabled:opacity-38",
  m3FocusRing,
);
import { ExpandableSearchButton } from "../explorer/components/ExpandableSearchButton";
import { SourcePathBar } from "../../components/Sources/SourcePathBar";
import { SourceDataRow } from "../../components/Sources/SourceDataRow";

const PAGE_SIZE = 100;

export function SourceDetail() {
  const { sourceId } = useParams<{ sourceId: string }>();
  const navigate = useNavigate();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Infinite scroll state
  const [allItems, setAllItems] = useState<
    Array<{
      id: string;
      external_id: string;
      title: string;
      preview: string | null;
      subtitle: string | null;
    }>
  >([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const {
    data: source,
    isLoading,
    error,
  } = useLibraryQuery({
    type: "sources.get",
    input: { source_id: sourceId ?? "" },
  });

  // Initial page
  const { data: initialItems, isLoading: itemsLoading } = useLibraryQuery({
    type: "sources.list_items",
    input: { source_id: sourceId ?? "", limit: PAGE_SIZE, offset: 0 },
  });

  // Seed allItems from initial fetch
  useEffect(() => {
    if (initialItems) {
      setAllItems(initialItems);
      setOffset(initialItems.length);
      setHasMore(initialItems.length >= PAGE_SIZE);
    }
  }, [initialItems]);

  // Reset when sourceId changes
  useEffect(() => {
    setAllItems([]);
    setOffset(0);
    setHasMore(true);
  }, [sourceId]);

  const { data: adapters } = useLibraryQuery({
    type: "adapters.list",
    input: {},
  });

  const syncMutation = useLibraryMutation("sources.sync");
  const deleteMutation = useLibraryMutation("sources.delete");
  const updateMutation = useLibraryMutation("adapters.update");

  const adapterHasUpdate =
    adapters?.find((a) => a.id === source?.adapter_id)?.update_available ??
    false;

  // Sync tab title with source name
  const { activeTabId, updateTabTitle } = useTabManager();
  useEffect(() => {
    if (source?.name) {
      updateTabTitle(activeTabId, source.name);
    }
  }, [source?.name, activeTabId, updateTabTitle]);

  // Filter items by search
  const filteredItems = useMemo(() => {
    if (!searchValue.trim()) return allItems;
    const q = searchValue.toLowerCase();
    return allItems.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.subtitle?.toLowerCase().includes(q) ||
        item.preview?.toLowerCase().includes(q),
    );
  }, [allItems, searchValue]);

  // Virtualizer
  // oxlint-disable-next-line react/incompatible-library -- @tanstack/react-virtual useVirtualizer() n'est pas memoizable par le compilateur React
  const virtualizer = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 20,
    // Avoid flushSync during render (React 19 compat)
    scrollToFn: (scrollOffset, { adjustments, behavior }, instance) => {
      const el = instance.scrollElement;
      if (!el) return;
      const top = scrollOffset + (adjustments ?? 0);
      el.scrollTo({ top, behavior });
    },
  });

  // Fetch next page
  const { data: nextPage } = useLibraryQuery(
    {
      type: "sources.list_items",
      input: {
        source_id: sourceId ?? "",
        limit: PAGE_SIZE,
        offset,
      },
    },
    { enabled: loadingMore && offset > 0 },
  );

  useEffect(() => {
    if (nextPage && loadingMore) {
      setAllItems((prev) => [...prev, ...nextPage]);
      setOffset((prev) => prev + nextPage.length);
      setHasMore(nextPage.length >= PAGE_SIZE);
      setLoadingMore(false);
    }
  }, [nextPage, loadingMore]);

  // Trigger load more when virtualizer reaches near the end
  const lastVirtualItem =
    virtualizer.getVirtualItems()[virtualizer.getVirtualItems().length - 1];
  const lastVirtualIndex = lastVirtualItem?.index;

  useEffect(() => {
    if (
      lastVirtualIndex !== undefined &&
      lastVirtualIndex >= filteredItems.length - 10 &&
      hasMore &&
      !loadingMore &&
      !searchValue
    ) {
      setLoadingMore(true);
    }
  }, [
    lastVirtualIndex,
    filteredItems.length,
    hasMore,
    loadingMore,
    searchValue,
  ]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-outline text-body-medium">Loading...</div>
      </div>
    );
  }

  if (error || !source) {
    return (
      <div className="p-6">
        <div className="rounded-medium bg-error-container p-4">
          <p className="text-body-medium text-on-error-container">
            Failed to load source: {error ? String(error) : "Not found"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TopBarPortal
        left={
          <>
            <TopBarItem id="back" label="Back" priority="high">
              <CircleButton
                icon="arrow_back"
                onClick={() => navigate("/sources")}
                title="Back"
              />
            </TopBarItem>
            <TopBarItem id="source-path" label="Path" priority="high">
              <SourcePathBar
                sourceName={source.name}
                itemCount={source.item_count}
              />
            </TopBarItem>
          </>
        }
        right={
          <>
            <TopBarItem id="search" label="Search" priority="high">
              <ExpandableSearchButton
                placeholder="Search items..."
                value={searchValue}
                onChange={setSearchValue}
                onClear={() => setSearchValue("")}
              />
            </TopBarItem>
            <TopBarItem id="sync" label="Sync" priority="high">
              <CircleButton
                icon="sync"
                onClick={() =>
                  syncMutation.mutate({
                    source_id: source.id,
                  })
                }
                title="Sync"
                active={syncMutation.isPending || source.status === "syncing"}
              />
            </TopBarItem>
            <TopBarItem id="more-actions" label="More" priority="normal">
              <MoreActionsMenu
                adapterHasUpdate={adapterHasUpdate}
                onUpdate={() =>
                  updateMutation.mutate({
                    adapter_id: source.adapter_id,
                  })
                }
                isUpdating={updateMutation.isPending}
                onDelete={() => setShowDeleteConfirm(true)}
              />
            </TopBarItem>
          </>
        }
      />

      {/* Banners */}
      {(updateMutation.data || updateMutation.error || syncMutation.error) && (
        <div className="border-outline-variant space-y-2 border-b px-6 py-3">
          {updateMutation.data && (
            <div className="bg-primary-container rounded-small p-3">
              <p className="text-on-primary-container text-body-small">
                Updated {updateMutation.data.adapter_id}: v
                {updateMutation.data.old_version} &rarr; v
                {updateMutation.data.new_version}
                {updateMutation.data.schema_changed
                  ? " (schema changed — will migrate on next sync)"
                  : ""}
              </p>
            </div>
          )}
          {updateMutation.error && (
            <div className="rounded-small bg-error-container p-3">
              <p className="text-body-small text-on-error-container">
                Update failed: {String(updateMutation.error)}
              </p>
            </div>
          )}
          {syncMutation.error && (
            <div className="rounded-small bg-error-container p-3">
              <p className="text-body-small text-on-error-container">
                Sync failed: {String(syncMutation.error)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Virtualized items list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {itemsLoading && (
          <div className="text-on-surface-variant py-12 text-center text-body-medium">
            Loading items...
          </div>
        )}

        {!itemsLoading && filteredItems.length === 0 && (
          <div className="text-on-surface-variant py-12 text-center text-body-medium">
            {searchValue
              ? "No matching items"
              : "No items yet. Run a sync to populate."}
          </div>
        )}

        {filteredItems.length > 0 && (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = filteredItems[virtualRow.index];
              if (!item) return null;
              return (
                <div
                  key={item.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <SourceDataRow
                    title={item.title}
                    preview={item.preview}
                    subtitle={item.subtitle}
                  />
                </div>
              );
            })}
          </div>
        )}

        {loadingMore && (
          <div className="text-outline py-4 text-center text-body-small">
            Loading more...
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/32">
          <div className="bg-surface-container-high w-full max-w-sm rounded-extra-large p-6 shadow-md3-3">
            <h3 className="text-on-surface text-headline-small">
              Delete source
            </h3>
            <p className="text-on-surface-variant mt-4 text-body-medium">
              This will permanently delete{" "}
              <strong className="text-on-surface">{source.name}</strong> and all
              its data.
            </p>
            {deleteMutation.error && (
              <p className="mt-2 text-body-small text-error">
                {String(deleteMutation.error)}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <Button
                aria-label="Cancel"
                title="Cancel"
                variant="text"
                size="lg"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteMutation.isPending}
              >
                <Icon name="close" size={18} />
              </Button>
              <button
                onClick={() =>
                  deleteMutation.mutate(
                    { source_id: source.id },
                    {
                      onSuccess: () => navigate("/sources"),
                    },
                  )
                }
                disabled={deleteMutation.isPending}
                className={clsx(
                  "relative inline-flex h-10 items-center rounded-full bg-error px-6 text-label-large text-on-error transition-colors duration-200 ease-standard",
                  "before:absolute before:inset-0 before:rounded-[inherit] before:bg-on-error before:opacity-0 hover:before:opacity-8 active:before:opacity-10",
                  "disabled:pointer-events-none disabled:bg-on-surface/12 disabled:text-on-surface/38",
                  m3FocusRing,
                )}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MoreActionsMenu({
  adapterHasUpdate,
  onUpdate,
  isUpdating,
  onDelete,
}: {
  adapterHasUpdate: boolean;
  onUpdate: () => void;
  isUpdating: boolean;
  onDelete: () => void;
}) {
  const popover = usePopover();

  return (
    <Popover.Root open={popover.open} onOpenChange={popover.setOpen}>
      <Popover.Trigger asChild>
        <CircleButton icon="more_horiz" title="More actions" />
      </Popover.Trigger>
      <Popover.Content
        side="bottom"
        align="end"
        sideOffset={8}
        className="!bg-surface-container z-50 w-[200px] !rounded-extra-small !px-0 !py-2 shadow-md3-2"
      >
        {adapterHasUpdate && (
          <button
            onClick={() => {
              onUpdate();
              popover.setOpen(false);
            }}
            disabled={isUpdating}
            className={clsx(menuItemClassName, "text-on-surface")}
          >
            <Icon name="upgrade" size={20} className="text-primary" />
            {isUpdating ? "Updating..." : "Update adapter"}
          </button>
        )}
        <button
          onClick={() => {
            onDelete();
            popover.setOpen(false);
          }}
          className={clsx(menuItemClassName, "text-error")}
        >
          <Icon name="delete" size={20} />
          Delete source
        </button>
      </Popover.Content>
    </Popover.Root>
  );
}
