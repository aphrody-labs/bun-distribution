import { useNormalizedQuery } from "../../contexts/SpacedriveContext";
import { usePlatform } from "../../contexts/PlatformContext";
import type { File } from "@aphrody/drive-client";
import { getContentKind } from "@aphrody/drive-client";
import { useCallback, useEffect, useMemo } from "react";
import { formatBytes } from "../../routes/explorer/utils";
import { CircleButton } from "@aphrody/m3-primitives";
import { ContentRenderer } from "./ContentRenderer";

function MetadataPanel({ file }: { file: File }) {
  return (
    <div className="w-[280px] min-w-[280px] bg-surface-container-low border-l border-outline-variant p-4 overflow-y-auto">
      <div className="space-y-4">
        <div>
          <div className="text-body-small text-on-surface-variant mb-1">Name</div>
          <div className="text-body-medium text-on-surface break-words">{file.name}</div>
        </div>

        <div>
          <div className="text-body-small text-on-surface-variant mb-1">Kind</div>
          <div className="text-body-medium text-on-surface capitalize">{getContentKind(file)}</div>
        </div>

        <div>
          <div className="text-body-small text-on-surface-variant mb-1">Size</div>
          <div className="text-body-medium text-on-surface">{formatBytes(file.size || 0)}</div>
        </div>

        {file.extension && (
          <div>
            <div className="text-body-small text-on-surface-variant mb-1">Extension</div>
            <div className="text-body-medium text-on-surface">{file.extension}</div>
          </div>
        )}

        {file.created_at && (
          <div>
            <div className="text-body-small text-on-surface-variant mb-1">Created</div>
            <div className="text-body-medium text-on-surface">{new Date(file.created_at).toLocaleString()}</div>
          </div>
        )}

        {file.modified_at && (
          <div>
            <div className="text-body-small text-on-surface-variant mb-1">Modified</div>
            <div className="text-body-medium text-on-surface">{new Date(file.modified_at).toLocaleString()}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function QuickPreview() {
  const platform = usePlatform();

  // Extract file_id from window label. Label format: "quick-preview-{file_id}"
  const fileId = useMemo(() => {
    if (!platform.getCurrentWindowLabel) return null;
    const match = platform.getCurrentWindowLabel().match(/^quick-preview-(.+)$/);
    return match ? match[1] : null;
  }, [platform]);

  const {
    data: file,
    isLoading,
    error,
  } = useNormalizedQuery<{ file_id: string }, File>({
    query: "files.by_id",
    input: { file_id: fileId! },
    resourceType: "file",
    resourceId: fileId!,
    enabled: !!fileId,
  });

  const handleClose = useCallback(() => {
    if (platform.closeCurrentWindow) {
      platform.closeCurrentWindow();
    }
  }, [platform]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose]);

  if (isLoading || !file) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface text-on-surface">
        <div className="animate-pulse text-body-medium text-on-surface-variant">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-surface text-error">
        <div>
          <div className="text-title-medium font-medium mb-2">Error loading file</div>
          <div className="text-body-medium">{error.message}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-surface text-on-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant">
        <div className="text-title-medium truncate flex-1">{file.name}</div>
        <CircleButton
          variant="standard"
          size="sm"
          icon="close"
          onClick={handleClose}
          title="Close"
          aria-label="Close"
        />
      </div>

      {/* Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* File Content */}
        <div className="flex-1 p-6 bg-surface-container/30">
          <ContentRenderer file={file} />
        </div>

        {/* Metadata Sidebar */}
        <MetadataPanel file={file} />
      </div>

      {/* Footer with keyboard hints */}
      <div className="px-4 py-2 border-t border-outline-variant bg-surface-container/30">
        <div className="text-body-small text-on-surface-variant text-center">
          Press <span className="text-on-surface">ESC</span> to close
        </div>
      </div>
    </div>
  );
}
