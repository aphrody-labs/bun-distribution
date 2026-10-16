import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { CircleButton } from "@aphrody/m3-primitives";
import { m3Durations, m3Easings } from "@aphrody/m3-motion";
import { useEffect, useState, useMemo } from "react";
import { ContentRenderer } from "./ContentRenderer";
import {
  VideoControls,
  type VideoControlsState,
  type VideoControlsCallbacks,
} from "./VideoControls";
import { TopBarPortal, TopBarItem } from "../../TopBar";
import { getContentKind } from "@aphrody/drive-client";
import { useExplorer } from "../../routes/explorer/context";

interface QuickPreviewFullscreenProps {
  fileId: string;
  isOpen: boolean;
  onClose: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
  sidebarWidth?: number;
  inspectorWidth?: number;
}

const PREVIEW_LAYER_ID = "quick-preview-layer";

export function QuickPreviewFullscreen({
  fileId,
  isOpen,
  onClose,
  onNext,
  onPrevious,
  hasPrevious,
  hasNext,
  sidebarWidth = 0,
  inspectorWidth = 0,
}: QuickPreviewFullscreenProps) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);
  const [videoControlsState, setVideoControlsState] =
    useState<VideoControlsState | null>(null);
  const [showVideoControls, setShowVideoControls] = useState(false);
  const [videoCallbacks, setVideoCallbacks] =
    useState<VideoControlsCallbacks | null>(null);
  const { currentFiles } = useExplorer();

  // Reset zoom when file changes (adjusted during render, no effect)
  const [zoomedFileId, setZoomedFileId] = useState(fileId);
  if (zoomedFileId !== fileId) {
    setZoomedFileId(fileId);
    setIsZoomed(false);
  }

  // Get file directly from currentFiles - instant, no network request
  const file = useMemo(
    () => currentFiles.find((f) => f.id === fileId) ?? null,
    [currentFiles, fileId],
  );

  // No query needed - files are already loaded by the explorer views
  const isLoading = false;
  const error = null as Error | null;

  // Find portal target on mount
  useEffect(() => {
    const target = document.getElementById(PREVIEW_LAYER_ID);
    // oxlint-disable-next-line react/set-state-in-effect -- cible de portail lue dans le DOM après montage : l'élément appartient à la couche racine, hors de ce composant
    setPortalTarget(target);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle close events - let Explorer handle navigation
      if (e.code === "Escape" || e.code === "Space") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, {
        capture: true,
      });
  }, [isOpen, onClose]);

  // Get background style based on content type
  const getBackgroundClass = () => {
    if (!file) return "bg-scrim/90";

    switch (getContentKind(file)) {
      case "video":
        return "bg-scrim";
      case "audio":
        return "audio-gradient";
      case "image":
        return "bg-scrim/95";
      default:
        return "bg-scrim/90";
    }
  };

  // Memoize TopBarItem children to prevent infinite re-renders
  const navigationButtons = useMemo(
    () => (
      // `dark`: the preview layer is an immersive dark surface, so the
      // top-bar items rendered over it use the dark scheme roles.
      <div className="dark flex items-center gap-1">
        <CircleButton
          variant="standard"
          size="sm"
          icon="arrow_back"
          onClick={onPrevious}
          disabled={!hasPrevious}
          title="Previous"
          aria-label="Previous"
        />
        <CircleButton
          variant="standard"
          size="sm"
          icon="arrow_forward"
          onClick={onNext}
          disabled={!hasNext}
          title="Next"
          aria-label="Next"
        />
        <div className="mx-1 h-4 w-px bg-outline-variant" />
      </div>
    ),
    [onPrevious, onNext, hasPrevious, hasNext],
  );

  const filenameDisplay = useMemo(
    () => (
      <div className="dark truncate text-title-small text-on-surface">
        {file?.name}
      </div>
    ),
    [file?.name],
  );

  const closeButton = useMemo(
    () => (
      <div className="dark">
        <CircleButton
          variant="standard"
          size="sm"
          icon="close"
          onClick={onClose}
          title="Close"
          aria-label="Close"
        />
      </div>
    ),
    [onClose],
  );

  if (!portalTarget) return null;

  const content = (
    <AnimatePresence mode="wait">
      {isOpen && (
        <motion.div
          key="fullscreen-preview"
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: {
              duration: m3Durations.short4,
              ease: m3Easings.emphasizedDecelerate,
            },
          }}
          exit={{
            opacity: 0,
            transition: {
              duration: m3Durations.short3,
              ease: m3Easings.emphasizedAccelerate,
            },
          }}
          className={`dark absolute inset-0 flex flex-col text-on-surface ${getBackgroundClass()}`}
        >
          {!file && isLoading ? (
            <div className="flex h-full items-center justify-center text-on-surface">
              <div className="animate-pulse text-body-medium">Loading...</div>
            </div>
          ) : !file && error ? (
            <div className="flex h-full items-center justify-center text-error">
              <div>
                <div className="mb-2 text-title-medium">Error loading file</div>
                <div className="text-body-medium">{error.message}</div>
              </div>
            </div>
          ) : !file ? (
            <div className="flex h-full items-center justify-center text-on-surface-variant">
              <div className="text-body-medium">File not found</div>
            </div>
          ) : (
            <>
              {/* TopBar content via portal */}
              <TopBarPortal
                left={
                  <>
                    {(hasPrevious || hasNext) && (
                      <TopBarItem
                        id="preview-navigation"
                        label="Navigation"
                        priority="high"
                      >
                        {navigationButtons}
                      </TopBarItem>
                    )}
                  </>
                }
                center={
                  <TopBarItem
                    id="preview-filename"
                    label="File name"
                    priority="high"
                  >
                    {filenameDisplay}
                  </TopBarItem>
                }
                right={
                  <TopBarItem
                    id="preview-close"
                    label="Close"
                    priority="high"
                    onClick={onClose}
                  >
                    {closeButton}
                  </TopBarItem>
                }
              />

              {/* Content Area - padded to fit between sidebar/inspector, expands on zoom */}
              <div
                className={`flex-1 pt-14 pb-10 ${isZoomed ? "overflow-visible" : "overflow-hidden"}`}
                style={{
                  paddingLeft: isZoomed ? 0 : sidebarWidth,
                  paddingRight: isZoomed ? 0 : inspectorWidth,
                  transition: "padding 0.3s ease-out",
                }}
              >
                <ContentRenderer
                  file={file}
                  onZoomChange={setIsZoomed}
                  onVideoControlsStateChange={setVideoControlsState}
                  onShowVideoControlsChange={setShowVideoControls}
                  getVideoCallbacks={setVideoCallbacks}
                />
              </div>

              {/* Video Controls Overlay - fixed position, always uses sidebar/inspector padding */}
              {videoControlsState &&
                videoCallbacks &&
                getContentKind(file) === "video" && (
                  <div
                    className="absolute inset-0"
                    style={{
                      paddingTop: "56px", // TopBar height
                      paddingBottom: "40px", // Footer height
                      pointerEvents: "none", // Let clicks through except on controls themselves
                    }}
                  >
                    <VideoControls
                      file={file}
                      state={videoControlsState}
                      callbacks={videoCallbacks}
                      showControls={showVideoControls}
                      sidebarWidth={sidebarWidth}
                      inspectorWidth={inspectorWidth}
                    />
                  </div>
                )}

              {/* Footer with keyboard hints */}
              <div className="absolute bottom-0 left-0 right-0 z-10 px-6 py-3">
                <div className="text-center text-body-small text-on-surface-variant/70">
                  <span className="text-on-surface-variant">ESC</span> or{" "}
                  <span className="text-on-surface-variant">Space</span> to
                  close
                  {(hasPrevious || hasNext) && (
                    <>
                      {" · "}
                      <span className="text-on-surface-variant">←</span> /{" "}
                      <span className="text-on-surface-variant">→</span> to
                      navigate
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, portalTarget);
}

export { PREVIEW_LAYER_ID };
