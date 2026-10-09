import { clsx } from "clsx";
import { memo } from "react";
import { Icon } from "@aphrody/m3-primitives";
import type { File } from "@aphrody/drive-client";
import { File as FileComponent } from "../../File";
import { useSelection } from "../../SelectionContext";
import { useFileContextMenu } from "../../hooks/useFileContextMenu";

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

interface MediaViewItemProps {
  file: File;
  allFiles: File[];
  selected: boolean;
  focused: boolean;
  onSelect: (file: File, files: File[], multi?: boolean, range?: boolean) => void;
  size: number;
}

export const MediaViewItem = memo(function MediaViewItem({
  file,
  allFiles,
  selected,
  focused,
  onSelect,
  size,
}: MediaViewItemProps) {
  const { selectedFiles } = useSelection();

  const contextMenu = useFileContextMenu({
    file,
    selectedFiles,
    selected,
  });

  const handleClick = (e: React.MouseEvent) => {
    const multi = e.metaKey || e.ctrlKey;
    const range = e.shiftKey;
    onSelect(file, allFiles, multi, range);
  };

  const handleContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!selected) {
      onSelect(file, allFiles, false, false);
    }

    await contextMenu.show(e);
  };

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the grid tile is a pointer target (click and context menu); keyboard navigation of the grid is handled by the window keydown listener of MediaView
    <div
      data-file-id={file.id}
      tabIndex={-1}
      className={clsx(
        "relative overflow-hidden cursor-pointer transition-all duration-200 ease-standard w-full h-full group outline-none focus:outline-none",
        selected && "ring-2 ring-primary ring-inset",
        focused && !selected && "ring-3 ring-secondary ring-inset",
      )}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      <FileComponent.Thumb
        file={file}
        size={size}
        className="w-full h-full"
        frameClassName="w-full h-full object-cover"
        iconScale={0.5}
        squareMode={true}
      />

      {/* Selection overlay */}
      {selected && <div className="absolute inset-0 bg-primary/10 pointer-events-none" />}

      {/* Video duration badge */}
      {file.video_media_data?.duration_seconds && (
        <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-extra-small bg-inverse-surface/80 text-inverse-on-surface text-label-small backdrop-blur-sm tabular-nums">
          {formatDuration(file.video_media_data.duration_seconds)}
        </div>
      )}

      {/* Hover overlay with file name */}
      <div className="absolute inset-x-0 bottom-0 px-2 py-1.5 bg-gradient-to-t from-surface/85 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 ease-standard">
        <div className="text-on-surface text-label-medium truncate">
          {file.name}
          {file.extension && `.${file.extension}`}
        </div>
      </div>

      {/* Selection checkbox (top-left corner, always visible when selected) */}
      {selected && (
        <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-primary text-on-primary flex items-center justify-center">
          <Icon name="check" size={14} weight={700} />
        </div>
      )}
    </div>
  );
});
