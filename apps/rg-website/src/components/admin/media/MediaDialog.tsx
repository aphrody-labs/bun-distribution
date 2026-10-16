"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ScrollArea,
} from "@rosegriffon/ui";
import { Loader2, Smile, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { EmoteGallery } from "@/components/shared/emotes/EmoteGallery";

import { authClient } from "@/lib/auth-client";
import { getBrowserStorage } from "@/lib/storage/browser";

interface MediaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (media: {
    type: "image" | "video" | "emote" | "youtube";
    src: string;
    alt?: string;
    title?: string;
  }) => void;
}

export function MediaDialog({ open, onOpenChange, onInsert }: MediaDialogProps) {
  const [activeTab, setActiveTab] = useState("upload");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast.error("Le fichier doit être une image");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("L'image ne doit pas dépasser 5Mo");
      return;
    }

    setIsUploading(true);
    try {
      const storage = getBrowserStorage();

      // Vérifier que l'utilisateur est bien authentifié
      // `authClient.getSession()` est async — un check sans await renvoyait toujours une Promise truthy.
      const { data: session } = await authClient.getSession();
      if (!session?.user) {
        toast.error("Vous devez être connecté pour uploader une image");
        return;
      }

      const fileExt = file.name.split(".").pop()?.toLowerCase();
      const fileName = `chronicles/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;

      const { error: uploadError } = await storage.from("assets").upload(fileName, file, {
        cacheControl: "3600",
        upsert: false,
      });

      if (uploadError) {
        console.error("Upload error details:", uploadError);
        if (uploadError.message?.includes("policy") || uploadError.message?.includes("permission")) {
          throw new Error("Permission refusée. Vérifiez que vous êtes admin.");
        }
        throw uploadError;
      }

      const {
        data: { publicUrl },
      } = storage.from("assets").getPublicUrl(fileName);

      onInsert({
        alt: file.name.split(".")[0],
        src: publicUrl,
        type: "image",
      });
      onOpenChange(false);
      toast.success("Image téléchargée avec succès");
    } catch (error) {
      console.error("Erreur upload:", error);
      const errorMessage = error instanceof Error ? error.message : "Erreur lors du téléchargement";
      toast.error(errorMessage);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle>Médiathèque</DialogTitle>
          <DialogDescription>Gérez vos images et emotes pour les insérer dans vos chroniques.</DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <div className="px-6 border-b">
            <TabsList className="w-full justify-start bg-transparent p-0 h-auto gap-6">
              <TabsTrigger
                value="upload"
                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-rg-rose rounded-none px-0 py-2"
              >
                <Upload className="size-4 mr-2" />
                Téléverser
              </TabsTrigger>
              <TabsTrigger
                value="emotes"
                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-rg-rose rounded-none px-0 py-2"
              >
                <Smile className="size-4 mr-2" />
                Emotes
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-hidden bg-slate-50">
            <TabsContent value="upload" className="h-full m-0 p-6 flex flex-col items-center justify-center">
              <div
                className={`w-full max-w-md aspect-video border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center bg-white transition-colors relative ${
                  isUploading ? "cursor-not-allowed opacity-50" : "hover:bg-slate-50 cursor-pointer"
                }`}
                onClick={() => !isUploading && fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileUpload}
                  disabled={isUploading}
                />
                {isUploading ? (
                  <div className="text-center">
                    <Loader2 className="size-10 animate-spin text-rg-rose mx-auto mb-4" />
                    <p className="text-sm text-slate-500">Téléchargement en cours...</p>
                  </div>
                ) : (
                  <div className="text-center p-6">
                    <div className="size-16 bg-rg-rose/10 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Upload className="size-8 text-rg-rose" />
                    </div>
                    <h3 className="font-semibold text-lg mb-2">Cliquez pour téléverser</h3>
                    <p className="text-sm text-slate-500">PNG, JPG, WEBP jusqu&apos;à 5Mo</p>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="emotes" className="h-full m-0 flex flex-col">
              <ScrollArea className="flex-1 p-6">
                <EmoteGallery
                  onSelect={emote => {
                    onInsert({
                      alt: emote.alt,
                      src: emote.src,
                      title: emote.name,
                      type: "emote",
                    });
                    onOpenChange(false);
                  }}
                />
              </ScrollArea>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
