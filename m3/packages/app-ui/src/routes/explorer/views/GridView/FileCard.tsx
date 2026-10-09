import { memo } from "react";
import { clsx } from "clsx";
import type { File } from "@aphrody/drive-client";
import { File as FileComponent } from "../../File";
import { useExplorer } from "../../context";
import { useSelection } from "../../SelectionContext";
import { formatBytes } from "../../utils";
import { TagDot } from "../../../../components/Tags";
import { useDroppable } from "@dnd-kit/core";
import { useFileContextMenu } from "../../hooks/useFileContextMenu";
import { useDraggableFile } from "../../hooks/useDraggableFile";
import { isVirtualFile } from "@aphrody/drive-client";
import { VolumeSizeBar } from "../../components/VolumeSizeBar";
import { InlineNameEdit } from "../../components/InlineNameEdit";
import { useOpenWith } from "../../../../hooks/useOpenWith";
import { useJobsContext } from "../../../../components/JobManager/hooks/JobsContext";

interface FileCardProps {
	file: File;
	fileIndex: number;
	allFiles: File[];
	selected: boolean;
	focused: boolean;
	selectedFiles: File[];
	selectFile: (file: File, files: File[], multi?: boolean, range?: boolean) => void;
}

export const FileCard = memo(
	function FileCard({
		file,
		fileIndex,
		allFiles,
		selected,
		focused: _focused,
		selectedFiles,
		selectFile,
	}: FileCardProps) {
		const { viewSettings, navigateToPath } = useExplorer();
		const { gridSize, showFileSize } = viewSettings;
		const { renamingFileId, saveRename, cancelRename } = useSelection();

		const isRenaming = renamingFileId === file.id;

		const contextMenu = useFileContextMenu({
			file,
			selectedFiles,
			selected,
		});

		// Set up file opening for non-directory files
		const physicalPath =
			file.kind === "File" && "Physical" in file.sd_path
				? [(file.sd_path as any).Physical.path]
				: [];
		const { openWithDefault } = useOpenWith(physicalPath);

		// Active job tracking for progress indication
		const { jobs } = useJobsContext();
		const activeJob = jobs.find((j) => {
			if (j.status !== "running" && j.status !== "queued") return false;
			const context = j.action_context?.context as any;
			const targetName = context?.target_name || (j.action_context?.action_input as any)?.target;
			const targetPath = j.current_path || (j.action_context?.action_input as any)?.path;
			if (targetName && targetName === file.name) return true;
			if (targetPath && physicalPath.length > 0 && targetPath === physicalPath[0]) return true;
			return false;
		});

		const handleClick = (e: React.MouseEvent) => {
			const multi = e.metaKey || e.ctrlKey;
			const range = e.shiftKey;
			selectFile(file, allFiles, multi, range);
		};

		const handleDoubleClick = async () => {
			// Virtual files (locations, volumes, devices) always navigate to their sd_path
			if (isVirtualFile(file) && file.sd_path) {
				navigateToPath(file.sd_path);
				return;
			}

			// Regular directories navigate normally
			if (file.kind === "Directory") {
				navigateToPath(file.sd_path);
				return;
			}

			// Open regular files with default application
			if (file.kind === "File" && "Physical" in file.sd_path) {
				const filePath = (file.sd_path as any).Physical.path;
				await openWithDefault(filePath);
			}
		};

		const handleContextMenu = async (e: React.MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();

			if (!selected) {
				selectFile(file, allFiles, false, false);
			}

			await contextMenu.show(e);
		};

		const {
			attributes,
			listeners,
			setNodeRef: setDragNodeRef,
			isDragging: dndIsDragging,
		} = useDraggableFile({
			file,
			selectedFiles: selected && selectedFiles.length > 0 ? selectedFiles : undefined,
			gridSize,
		});

		// Make folders droppable
		const isFolder = file.kind === "Directory";
		const { setNodeRef: setDropNodeRef, isOver: isDropOver } = useDroppable({
			id: `folder-drop-${file.id}`,
			disabled: !isFolder,
			data: {
				action: "move-into",
				targetType: "folder",
				targetId: file.id,
				targetPath: file.sd_path,
			},
		});

		// Combine refs for folders that are both draggable and droppable
		const setNodeRef = (node: HTMLElement | null) => {
			setDragNodeRef(node);
			if (isFolder) setDropNodeRef(node);
		};

		const thumbSize = Math.max(gridSize * 0.6, 60);

		// Check if this is a virtual volume file
		const isVolume =
			isVirtualFile(file) &&
			(file as any)._virtual?.type === "volume" &&
			(file as any)._virtual?.data;

		// Extract volume data
		const volumeData = isVolume ? (file as any)._virtual.data : null;
		const hasVolumeCapacity =
			volumeData?.total_capacity != null &&
			volumeData?.available_space != null &&
			volumeData.total_capacity > 0;

		return (
			<div
				ref={setNodeRef}
				{...listeners}
				{...attributes}
				data-file-id={file.id}
				data-index={fileIndex}
				data-selectable="true"
				tabIndex={-1}
				className="relative outline-none focus:outline-none"
			>
				{/* Drop indicator for folders */}
				{isFolder && isDropOver && (
					<div className="absolute inset-0 rounded-medium ring-2 ring-primary ring-inset pointer-events-none z-10" />
				)}
				<FileComponent
					file={file}
					selected={selected && !dndIsDragging}
					onClick={handleClick}
					onDoubleClick={handleDoubleClick}
					onContextMenu={handleContextMenu}
					layout="column"
					className={clsx(
						"flex flex-col items-center gap-2 p-1 rounded-medium transition-all duration-200 ease-standard",
						dndIsDragging && "opacity-40",
						isFolder && isDropOver && "bg-primary/8",
					)}
				>
					<div
						className={clsx(
							"rounded-medium p-2 flex flex-col items-center",
							selected && !dndIsDragging ? "bg-surface-container-highest" : "bg-transparent",
						)}
					>
						<FileComponent.Thumb file={file} size={thumbSize} />
						{/* Progress bar under thumbnail per UI-DESIGN.md §4.2 */}
						{activeJob && (
							<div className="w-full h-1 bg-surface-container-highest rounded-full overflow-hidden mt-1.5 shadow-xs">
								<div
									className="h-full bg-primary transition-all duration-300 ease-out"
									style={{
										width: `${Math.max(10, Math.min(100, (activeJob.progress ?? 0) * 100))}%`,
									}}
								/>
							</div>
						)}
					</div>
					<div className="w-full flex flex-col items-center">
						{isRenaming ? (
							<InlineNameEdit
								file={file}
								onSave={saveRename}
								onCancel={cancelRename}
								className="max-w-full"
							/>
						) : (
							<div
								className={clsx(
									"text-body-large truncate px-2 py-0.5 rounded-small inline-block max-w-full font-medium",
									selected && !dndIsDragging
										? "bg-secondary-container text-on-secondary-container"
										: "text-on-surface",
								)}
							>
								{file.name}
								{file.extension && `.${file.extension}`}
							</div>
						)}

						{/* Volume size bar */}
						{showFileSize && hasVolumeCapacity && (
							<VolumeSizeBar
								totalBytes={Number(volumeData.total_capacity)}
								availableBytes={Number(volumeData.available_space)}
								className="mt-1.5"
							/>
						)}

						{/* Regular file size */}
						{showFileSize && !hasVolumeCapacity && file.size > 0 && (
							<div className="text-body-large text-on-surface-variant mt-0.5">
								{formatBytes(file.size)}
							</div>
						)}

						{/* Tag Indicators */}
						{file.tags && file.tags.length > 0 && (
							<div
								className="flex items-center gap-1 mt-1"
								title={file.tags.map((t) => t.canonical_name).join(", ")}
							>
								{file.tags.slice(0, 3).map((tag) => (
									<TagDot
										key={tag.id}
										color={tag.color || "var(--md-sys-color-primary)"}
										tooltip={tag.canonical_name}
									/>
								))}
								{file.tags.length > 3 && (
									<span className="text-label-small text-outline">+{file.tags.length - 3}</span>
								)}
							</div>
						)}
					</div>
				</FileComponent>
			</div>
		);
	},
	(prev, next) => {
		// Custom comparison - rerender if file object, selection, or focus changed
		// Ignore selectedFiles and selectFile function reference changes
		if (prev.file !== next.file) return false; // File object reference changed
		if (prev.selected !== next.selected) return false; // Selection state changed
		if (prev.focused !== next.focused) return false; // Focus state changed
		if (prev.fileIndex !== next.fileIndex) return false; // Index changed
		// Ignore: allFiles, selectedFiles, selectFile (passed through to handlers)
		return true; // Props are equal, skip rerender
	},
);
