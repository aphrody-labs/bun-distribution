import type { File } from "@aphrody/drive-client";
import { getContentKind, isVirtualFile } from "@aphrody/drive-client";
import { toast } from "@aphrody/m3-primitives";
import { useFileOperationDialog } from "../../../components/modals/FileOperationModal";
import { usePlatform } from "../../../contexts/PlatformContext";
import { useLibraryMutation } from "../../../contexts/SpacedriveContext";
import { useClipboard } from "../../../hooks/useClipboard";
import { useContextMenu } from "../../../hooks/useContextMenu";
import { useOpenWith } from "../../../hooks/useOpenWith";
import { useRefetchTagQueries } from "../../../hooks/useRefetchTagQueries";
import { useExplorer } from "../context";
import { useSelection } from "../SelectionContext";
import { useAskAphrody } from "./useAskAphrody";
import { useDeleteFiles } from "./useDeleteFiles";

interface UseFileContextMenuProps {
  file?: File | null;
  selectedFiles: File[];
  selected: boolean;
}

// Helper to run a mutation on each target file
async function forEachTarget(targets: File[], fn: (f: File) => Promise<unknown>) {
  for (const f of targets) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- preserve ordered mutations per target file.
      await fn(f);
    } catch (err) {
      console.error(`Failed for ${f.name}:`, err);
    }
  }
}

export function useFileContextMenu({ file, selectedFiles, selected }: UseFileContextMenuProps) {
  const { navigateToPath, currentPath, mode, openQuickPreview } = useExplorer();
  const platform = usePlatform();
  const refetchTagQueries = useRefetchTagQueries();

  const { deleteFiles } = useDeleteFiles();
  const unapplyTags = useLibraryMutation("tags.unapply", {
    onSuccess: refetchTagQueries,
  });
  const createFolder = useLibraryMutation("files.createFolder");
  const regenerateThumbnail = useLibraryMutation("media.thumbnail.regenerate");
  const generateThumbstrip = useLibraryMutation("media.thumbstrip.generate");
  const generateProxy = useLibraryMutation("media.proxy.generate");

  const clipboard = useClipboard();
  const openFileOperation = useFileOperationDialog();
  const { startRename } = useSelection();

  // Get physical paths for file opening
  const getPhysicalPaths = () => {
    const targets = selected && selectedFiles.length > 0 ? selectedFiles : [file];
    return targets
      .filter((f): f is File => f != null && f.sd_path != null && "Physical" in f.sd_path)
      .map(f => (f.sd_path as any).Physical.path);
  };

  const physicalPaths = getPhysicalPaths();
  const { apps, openWithDefault, openWithApp, openMultipleWithApp } = useOpenWith(physicalPaths);

  // Get the files to operate on (multi-select or just this file)
  // Filters out virtual files (they're display-only, not real filesystem entries)
  const getTargetFiles = () => {
    const targets = selected && selectedFiles.length > 0 ? selectedFiles : [file];
    // Filter out virtual files - they cannot be copied/moved/deleted
    return targets.filter((f): f is File => f != null && !isVirtualFile(f));
  };

  // Check if any selected files are virtual (to disable certain operations)
  const hasVirtualFiles = selected ? selectedFiles.some(f => isVirtualFile(f)) : file ? isVirtualFile(file) : false;

  const askAphrody = useAskAphrody();

  return useContextMenu({
    items: [
      {
        icon: "visibility",
        label: "Aperçu rapide",
        onClick: () => {
          if (!file) return;
          openQuickPreview(file.id);
        },
        keybind: "Space",
        condition: () => !!file,
      },
      {
        icon: "folder_open",
        label: "Ouvrir",
        onClick: async () => {
          if (!file) return;
          if (file.kind === "Directory") {
            navigateToPath(file.sd_path);
          } else if ("Physical" in file.sd_path) {
            const physicalPath = (file.sd_path as any).Physical.path;
            await openWithDefault(physicalPath);
          }
        },
        keybind: "⌘O",
        condition: () => !!file && (file.kind === "Directory" || file.kind === "File"),
      },
      {
        type: "submenu",
        icon: "open_in_new",
        label: "Ouvrir avec",
        condition: () => !!file && file.kind === "File" && "Physical" in file.sd_path && apps.length > 0,
        submenu: apps.map(app => ({
          label: app.name,
          onClick: async () => {
            if (!file) return;
            if (selected && selectedFiles.length > 1) {
              await openMultipleWithApp(physicalPaths, app.id);
            } else if ("Physical" in file.sd_path) {
              const physicalPath = (file.sd_path as any).Physical.path;
              await openWithApp(physicalPath, app.id);
            }
          },
        })),
      },
      {
        icon: "search",
        label: "Afficher dans l'explorateur",
        onClick: async () => {
          if (!file) return;
          // Extract the physical path from SdPath
          if ("Physical" in file.sd_path) {
            const physicalPath = file.sd_path.Physical.path;
            if (platform.revealFile) {
              try {
                await platform.revealFile(physicalPath);
              } catch (err) {
                console.error("Failed to reveal file:", err);
                toast.error(`Erreur d'affichage du fichier : ${err}`);
              }
            } else {
              console.log("revealFile not supported on this platform");
            }
          } else {
            console.log("Cannot reveal non-physical file");
          }
        },
        keybind: "⌘⇧R",
        condition: () => !!file && "Physical" in file.sd_path && !!platform.revealFile,
      },
      {
        icon: "share",
        label: selected && selectedFiles.length > 1 ? `Partager ${selectedFiles.length} éléments` : "Partager",
        onClick: async () => {
          const paths = physicalPaths;
          if (paths.length === 0) {
            console.warn("No physical files to share");
            return;
          }
          if (platform.shareFiles) {
            try {
              await platform.shareFiles(paths);
            } catch (err) {
              console.error("Failed to share files:", err);
              toast.error(`Erreur de partage : ${err}`);
            }
          }
        },
        condition: () => physicalPaths.length > 0 && !!platform.shareFiles,
      },
      { type: "separator" },
      // Actions d'IA contextuelles Aphrody
      {
        icon: "auto_awesome",
        label: "Demander à Aphrody",
        onClick: () => askAphrody(getTargetFiles()),
        condition: () => getTargetFiles().length > 0,
      },
      { type: "separator" },
      {
        icon: "edit",
        label: "Renommer",
        onClick: () => {
          if (!file) return;
          startRename(file.id);
        },
        keybindId: "explorer.renameFile",
        condition: () => !!file && selected && selectedFiles.length === 1 && !hasVirtualFiles,
      },
      {
        icon: "create_new_folder",
        label: "Nouveau dossier",
        onClick: async () => {
          if (!currentPath) return;
          try {
            const result = await createFolder.mutateAsync({
              parent: currentPath,
              name: "Nouveau dossier",
              items: [],
            });
            console.log("Created folder:", result);
          } catch (err) {
            console.error("Failed to create folder:", err);
            toast.error(`Erreur de création du dossier : ${err}`);
          }
        },
        condition: () => !!currentPath,
      },
      {
        icon: "create_new_folder",
        label: "Nouveau dossier avec la sélection",
        onClick: async () => {
          if (!currentPath) return;
          const targets = getTargetFiles();
          if (targets.length === 0) return;

          try {
            const result = await createFolder.mutateAsync({
              parent: currentPath,
              name: "Nouveau dossier",
              items: targets.map(f => f.sd_path),
            });
            console.log("Created folder with items:", result);
          } catch (err) {
            console.error("Failed to create folder with items:", err);
            toast.error(`Erreur de création du dossier : ${err}`);
          }
        },
        condition: () => !!currentPath && selectedFiles.length > 0 && !hasVirtualFiles,
      },
      { type: "separator" },
      {
        icon: "content_copy",
        label: selected && selectedFiles.length > 1 ? `Copier ${selectedFiles.length} éléments` : "Copier",
        onClick: () => {
          const targets = getTargetFiles();
          if (targets.length === 0) {
            console.warn("Cannot copy virtual files");
            return;
          }
          const sdPaths = targets.map(f => f.sd_path);
          clipboard.copyFiles(sdPaths, currentPath);
        },
        keybindId: "explorer.copy",
        condition: () => !hasVirtualFiles,
      },
      {
        icon: "content_cut",
        label: selected && selectedFiles.length > 1 ? `Couper ${selectedFiles.length} éléments` : "Couper",
        onClick: () => {
          const targets = getTargetFiles();
          if (targets.length === 0) {
            console.warn("Cannot cut virtual files");
            return;
          }
          const sdPaths = targets.map(f => f.sd_path);
          clipboard.cutFiles(sdPaths, currentPath);
        },
        keybindId: "explorer.cut",
        condition: () => !hasVirtualFiles,
      },
      {
        icon: "content_paste",
        label: "Coller",
        onClick: () => {
          if (!clipboard.hasClipboard() || !currentPath) {
            console.log("[Clipboard] Nothing to paste or no destination");
            return;
          }

          const operation = clipboard.operation === "cut" ? "move" : "copy";

          console.groupCollapsed(
            `[Clipboard] Pasting ${clipboard.files.length} file${clipboard.files.length === 1 ? "" : "s"} (${operation})`,
          );
          console.log("Operation:", operation);
          console.log("Destination:", currentPath);
          console.log("Source files (SdPath objects):");
          clipboard.files.forEach((clipboardFile, index) => {
            console.log(`  [${index}]:`, JSON.stringify(clipboardFile, null, 2));
          });
          console.groupEnd();

          openFileOperation({
            operation,
            sources: clipboard.files,
            destination: currentPath,
            onComplete: () => {
              // Clear clipboard after cut operation completes
              if (clipboard.operation === "cut") {
                console.log("[Clipboard] Operation completed, clearing clipboard");
                clipboard.clearClipboard();
              } else {
                console.log("[Clipboard] Copy operation completed");
              }
            },
          });
        },
        keybindId: "explorer.paste",
        condition: () => clipboard.hasClipboard(),
      },
      // Media Processing submenu
      {
        type: "submenu",
        icon: "image",
        label: "Traitement d'image",
        condition: () => !!file && getContentKind(file) === "image",
        submenu: [
          {
            icon: "auto_awesome",
            label: "Générer le Blurhash",
            onClick: async () => {
              const targets = getTargetFiles();
              await forEachTarget(targets, f =>
                regenerateThumbnail.mutateAsync({
                  entry_uuid: f.id,
                  variants: null,
                  force: false,
                }),
              );
            },
            condition: () => !!file && !file.image_media_data?.blurhash,
          },
          {
            icon: "crop",
            label: "Régénérer la miniature",
            onClick: async () => {
              const targets = getTargetFiles();
              await forEachTarget(targets, f =>
                regenerateThumbnail.mutateAsync({
                  entry_uuid: f.id,
                  variants: null,
                  force: true,
                }),
              );
            },
          },
        ],
      },
      {
        type: "submenu",
        icon: "videocam",
        label: "Traitement vidéo",
        condition: () => !!file && getContentKind(file) === "video",
        submenu: [
          {
            icon: "movie",
            label: "Générer la bande de vignettes",
            onClick: async () => {
              const targets = getTargetFiles();
              await forEachTarget(targets, f =>
                generateThumbstrip.mutateAsync({
                  entry_uuid: f.id,
                  variants: null,
                  force: false,
                }),
              );
            },
            condition: () => !!file && !file.sidecars?.some(s => s.kind === "thumbstrip"),
          },
          {
            icon: "auto_awesome",
            label: "Générer le Blurhash",
            onClick: async () => {
              const targets = getTargetFiles();
              await forEachTarget(targets, f =>
                regenerateThumbnail.mutateAsync({
                  entry_uuid: f.id,
                  variants: null,
                  force: false,
                }),
              );
            },
            condition: () => !!file && !file.video_media_data?.blurhash,
          },
          {
            icon: "crop",
            label: "Régénérer la miniature",
            onClick: async () => {
              const targets = getTargetFiles();
              await forEachTarget(targets, f =>
                regenerateThumbnail.mutateAsync({
                  entry_uuid: f.id,
                  variants: null,
                  force: true,
                }),
              );
            },
          },
          {
            icon: "video_file",
            label: "Générer un proxy",
            onClick: async () => {
              const targets = getTargetFiles();
              await forEachTarget(targets, f =>
                generateProxy.mutateAsync({
                  entry_uuid: f.id,
                  resolution: null,
                  force: false,
                  use_hardware_accel: null,
                }),
              );
            },
            keybind: "⌘⇧P",
          },
        ],
      },
      {
        type: "submenu",
        icon: "description",
        label: "Traitement documentaire",
        condition: () => !!file && file.kind === "File" && ["pdf", "doc", "docx"].includes(file.extension || ""),
        submenu: [
          {
            icon: "crop",
            label: "Régénérer la miniature",
            onClick: async () => {
              const targets = getTargetFiles();
              await forEachTarget(targets, f =>
                regenerateThumbnail.mutateAsync({
                  entry_uuid: f.id,
                  variants: null,
                  force: true,
                }),
              );
            },
          },
        ],
      },
      // Batch operations submenu
      {
        type: "submenu",
        icon: "stacks",
        label: `Traiter ${selectedFiles.length} éléments`,
        condition: () => selected && selectedFiles.length > 1,
        submenu: [
          {
            icon: "crop",
            label: "Régénérer toutes les miniatures",
            onClick: async () => {
              await forEachTarget(selectedFiles, f =>
                regenerateThumbnail.mutateAsync({
                  entry_uuid: f.id,
                  variants: null,
                  force: true,
                }),
              );
            },
          },
          {
            icon: "auto_awesome",
            label: "Générer les Blurhashes",
            onClick: async () => {
              await forEachTarget(selectedFiles, f =>
                regenerateThumbnail.mutateAsync({
                  entry_uuid: f.id,
                  variants: null,
                  force: false,
                }),
              );
            },
            keybind: "⌘⇧B",
          },
        ],
      },
      {
        icon: "label",
        label:
          selected && selectedFiles.length > 1
            ? `Retirer le tag de ${selectedFiles.length} éléments`
            : "Retirer le tag",
        onClick: async () => {
          if (mode.type !== "tag") return;
          const targets = getTargetFiles();
          if (targets.length === 0) return;
          try {
            await unapplyTags.mutateAsync({
              entry_ids: targets.map(f => f.id),
              tag_ids: [mode.tagId],
            });
          } catch (err) {
            console.error("Failed to remove tag:", err);
            toast.error(`Erreur de retrait du tag : ${err}`);
          }
        },
        condition: () => mode.type === "tag" && !hasVirtualFiles,
      },
      { type: "separator" },
      {
        icon: "delete",
        label: selected && selectedFiles.length > 1 ? `Supprimer ${selectedFiles.length} éléments` : "Supprimer",
        onClick: async () => {
          const targets = getTargetFiles();
          await deleteFiles(targets, false);
        },
        keybind: "⌘⌫",
        variant: "danger" as const,
        condition: () => !hasVirtualFiles,
      },
    ],
  });
}
