"use client";

import { useResetState } from "@/hooks/use-reset-state";

import {
  Button,
  Card,
  CardContent,
  Input,
  StorageImage,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rosegriffon/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { logAction } from "@/app/admin/actions/log";

import {
  ChevronRight,
  Copy,
  Folder,
  Home,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  Search,
  Trash2,
} from "@/lib/icons-config";
import { getBrowserStorage } from "@/lib/storage/browser";

import { MediaUploader } from "./media-uploader";

interface FileObject {
  name: string;
  id: string | null;
  updated_at: string | null;
  created_at: string | null;
  last_accessed_at: string | null;
  metadata: {
    size: number;
    mimetype: string;
    [key: string]: unknown;
  } | null;
}

interface MediaManagerProps {
  initialFiles: FileObject[];
}

export function MediaManager({ initialFiles }: MediaManagerProps) {
  const [files, _setFiles] = useResetState<FileObject[]>(initialFiles, initialFiles);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [currentPath, setCurrentPath] = useState<string>("");
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(searchParams?.get("query") || "");

  const router = useRouter();
  const storage = getBrowserStorage();

  const handleSearch = useCallback(
    (term: string) => {
      const params = new URLSearchParams(searchParams?.toString() || "");
      if (term) {
        params.set("query", term);
      } else {
        params.delete("query");
      }
      params.set("page", "1");
      router.replace(`/admin/media?${params.toString()}`);
    },
    [searchParams, router],
  );

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      handleSearch(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery, handleSearch]);

  const refreshFiles = () => {
    router.refresh();
  };

  const copyToClipboard = (name: string) => {
    const { data } = storage.from("assets").getPublicUrl(name);
    navigator.clipboard.writeText(data.publicUrl);
    toast.success("URL copiée !");
  };

  const deleteFile = async (name: string, id: string | null) => {
    if (!id || !confirm("Êtes-vous sûr de vouloir supprimer ce fichier ?")) {
      return;
    }

    setDeletingId(id);
    const { error } = await storage.from("assets").remove([name]);

    if (error) {
      toast.error("Erreur lors de la suppression");
    } else {
      toast.success("Fichier supprimé");
      await logAction("delete_file", "media", id, { name });
      refreshFiles();
    }
    setDeletingId(null);
  };

  // Folder Logic
  const getFileTree = () => {
    const tree: { folders: string[]; files: FileObject[] } = {
      files: [],
      folders: [],
    };
    const processedFolders = new Set<string>();

    files.forEach(file => {
      if (!file.name.startsWith(currentPath)) {
        return;
      }

      const relativePath = file.name.slice(currentPath.length);
      // If currentPath is not empty, it ends with /, so relativePath is just the rest
      // If currentPath is empty, relativePath is full name

      const parts = relativePath.split("/");

      if (parts.length > 1) {
        // It's in a subfolder
        const folderName = parts[0];
        if (folderName && !processedFolders.has(folderName)) {
          tree.folders.push(folderName);
          processedFolders.add(folderName);
        }
      } else {
        // It's in the current directory
        // Check if it is a folder (no id)
        if (!file.id) {
          const folderName = parts[0];
          if (folderName && !processedFolders.has(folderName)) {
            tree.folders.push(folderName);
            processedFolders.add(folderName);
          }
        } else {
          tree.files.push(file);
        }
      }
    });
    return tree;
  };

  const { folders, files: currentFiles } = getFileTree();

  const navigateToFolder = (folderName: string) => {
    setCurrentPath(prev => `${prev + folderName}/`);
  };

  const navigateUp = () => {
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    setCurrentPath(parts.length > 0 ? `${parts.join("/")}/` : "");
  };

  const breadcrumbs = currentPath.split("/").filter(Boolean);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <MediaUploader onUploadComplete={refreshFiles} />
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button variant="ghost" size="icon" onClick={() => setCurrentPath("")} disabled={!currentPath}>
            <Home className="size-4" />
          </Button>
          {breadcrumbs.map((part, index) => (
            <div key={index} className="flex items-center gap-1">
              <ChevronRight className="size-4 text-muted-foreground" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const newPath = `${breadcrumbs.slice(0, index + 1).join("/")}/`;
                  setCurrentPath(newPath);
                }}
              >
                {part}
              </Button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher des fichiers..."
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="flex border rounded-md">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setViewMode("grid")}
              className="rounded-r-none"
            >
              <LayoutGrid className="size-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setViewMode("list")}
              className="rounded-l-none"
            >
              <ListIcon className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {viewMode === "grid" ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {currentPath && (
            <Card
              className="cursor-pointer hover:bg-accent/50 transition-colors flex flex-col items-center justify-center p-6 aspect-square"
              onClick={navigateUp}
            >
              <Folder className="size-12 text-blue-300 mb-2" />
              <span className="text-sm font-medium">..</span>
            </Card>
          )}
          {folders.map(folder => (
            <Card
              key={folder}
              className="cursor-pointer hover:bg-accent/50 transition-colors flex flex-col items-center justify-center p-6 aspect-square"
              onClick={() => navigateToFolder(folder)}
            >
              <Folder className="size-12 text-blue-500 mb-2" />
              <span className="text-sm font-medium truncate w-full text-center">{folder}</span>
            </Card>
          ))}
          {currentFiles.map(file => (
            <Card key={file.id} className="group relative overflow-hidden">
              <div className="aspect-square relative bg-muted">
                <StorageImage src={file.name} alt={file.name} fill className="object-cover" />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <Button size="icon" variant="secondary" onClick={() => copyToClipboard(file.name)}>
                    <Copy className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="destructive"
                    onClick={() => deleteFile(file.name, file.id)}
                    disabled={deletingId === file.id}
                  >
                    {deletingId === file.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                  </Button>
                </div>
              </div>
              <div className="p-2">
                <p className="text-xs truncate" title={file.name}>
                  {file.name.split("/").pop()}
                </p>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]" />
                <TableHead>Nom</TableHead>
                <TableHead>Taille</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentPath && (
                <TableRow className="cursor-pointer hover:bg-muted/50" onClick={navigateUp}>
                  <TableCell>
                    <Folder className="size-4 text-blue-300" />
                  </TableCell>
                  <TableCell colSpan={5}>..</TableCell>
                </TableRow>
              )}
              {folders.map(folder => (
                <TableRow
                  key={folder}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigateToFolder(folder)}
                >
                  <TableCell>
                    <Folder className="size-4 text-blue-500" />
                  </TableCell>
                  <TableCell className="font-medium">{folder}</TableCell>
                  <TableCell>-</TableCell>
                  <TableCell>Dossier</TableCell>
                  <TableCell>-</TableCell>
                  <TableCell />
                </TableRow>
              ))}
              {currentFiles.map(file => (
                <TableRow key={file.id}>
                  <TableCell>
                    <div className="size-8 relative rounded overflow-hidden bg-muted">
                      <StorageImage src={file.name} alt={file.name} fill className="object-cover" />
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{file.name.split("/").pop()}</TableCell>
                  <TableCell>{file.metadata ? `${(file.metadata.size / 1024).toFixed(1)} KB` : "-"}</TableCell>
                  <TableCell>{file.metadata?.mimetype || "-"}</TableCell>
                  <TableCell>{file.created_at ? new Date(file.created_at).toLocaleDateString() : "-"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="icon" variant="ghost" onClick={() => copyToClipboard(file.name)}>
                        <Copy className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-red-500 hover:text-red-600"
                        onClick={() => deleteFile(file.name, file.id)}
                        disabled={deletingId === file.id}
                      >
                        {deletingId === file.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
