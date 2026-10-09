import { usePlatform } from "../contexts/PlatformContext";

/**
 * Floating controls overlay - demonstrates Cap-style tiny floating windows
 * Transparent background, rounded, always on top
 */
export function FloatingControls() {
  const platform = usePlatform();

  const handleClose = () => {
    if (platform.closeWindow) {
      platform.closeWindow("floating-controls");
    }
  };

  return (
    <div className="h-full w-full flex items-center justify-center p-2">
      <div
        className="bg-black/80 backdrop-blur-xl rounded-full px-4 py-3 shadow-md3-5 border border-white/10"
        style={{ WebkitAppRegion: "drag" } as any}
      >
        <div className="flex items-center gap-3">
          <button
            aria-label="Stop"
            className="w-8 h-8 rounded-full bg-error hover:bg-error transition-colors flex items-center justify-center"
            style={{ WebkitAppRegion: "no-drag" } as any}
            onClick={() => alert("Stop!")}
          >
            <div className="w-3 h-3 bg-white rounded-extra-small" />
          </button>
          <button
            className="w-8 h-8 rounded-full bg-outline hover:bg-outline transition-colors flex items-center justify-center"
            style={{ WebkitAppRegion: "no-drag" } as any}
            onClick={handleClose}
          >
            <span className="text-white text-title-large leading-none">×</span>
          </button>
        </div>
      </div>
    </div>
  );
}
