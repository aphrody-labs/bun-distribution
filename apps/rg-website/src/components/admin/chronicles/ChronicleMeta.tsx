import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  Label,
} from "@rosegriffon/ui";
import { Crop, ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";
import { toast } from "sonner";

import ImageCropper from "@/components/shared/ImageCropper";

import { getBrowserStorage } from "@/lib/storage/browser";

interface ChronicleMetaProps {
  title: string;
  onTitleChange: (value: string) => void;
  slug: string;
  setSlug: (value: string) => void;
  excerpt: string;
  setExcerpt: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  featuredImage: string;
  setFeaturedImage: (value: string) => void;
  onImageUpload: () => void;
}

export function ChronicleMeta({
  title,
  onTitleChange,
  slug,
  setSlug,
  excerpt,
  setExcerpt,
  category,
  setCategory,
  featuredImage,
  setFeaturedImage,
  onImageUpload,
}: ChronicleMetaProps) {
  const [showCropper, setShowCropper] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (!file) {
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        toast.error("L'image est trop volumineuse (max 5Mo)");
        return;
      }

      const reader = new FileReader();
      reader.addEventListener("load", () => {
        setCropImageSrc(reader.result as string);
        setShowCropper(true);
      });
      reader.readAsDataURL(file);
    }
  };

  const handleCropComplete = async (croppedBlob: Blob) => {
    setIsUploading(true);
    try {
      const storage = getBrowserStorage();

      const fileName = `chronicles/${Date.now()}-cropped.jpg`;

      const { error: uploadError } = await storage.from("assets").upload(fileName, croppedBlob, {
        contentType: "image/jpeg",
        upsert: true,
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

      setFeaturedImage(publicUrl);
      toast.success("Image recadrée et uploadée !");
    } catch (error) {
      console.error("Erreur upload:", error);
      const errorMessage = error instanceof Error ? error.message : "Erreur lors de l'upload de l'image";
      toast.error(errorMessage);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="space-y-4">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileSelect} />

      {cropImageSrc && (
        <ImageCropper
          open={showCropper}
          onOpenChange={setShowCropper}
          imageSrc={cropImageSrc}
          aspectRatio={16 / 9}
          onCropComplete={handleCropComplete}
        />
      )}

      <div>
        <Label htmlFor="title">Titre de la chronique</Label>
        <Input
          id="title"
          value={title}
          onChange={e => onTitleChange(e.target.value)}
          placeholder="Ex: Nouveautés de novembre 2025"
          required
          className="text-lg font-semibold"
        />
      </div>

      <div>
        <Label htmlFor="slug">URL</Label>
        <div className="flex mt-1.5">
          <div className="flex items-center px-3 border border-r-0 rounded-l-md bg-muted text-muted-foreground text-sm">
            rosegriffon.fr/chroniques/
          </div>
          <Input
            id="slug"
            value={slug}
            onChange={e => setSlug(e.target.value)}
            placeholder="nouveautes-novembre-2025"
            required
            className="rounded-l-none"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="excerpt">Résumé court</Label>
        <Textarea
          id="excerpt"
          value={excerpt}
          onChange={e => setExcerpt(e.target.value)}
          placeholder="Bref résumé visible dans la liste..."
          rows={3}
          required
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="category">Catégorie</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger id="category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="actualites">Actualités</SelectItem>
              <SelectItem value="projets">Projets</SelectItem>
              <SelectItem value="coulisses">Coulisses</SelectItem>
              <SelectItem value="communaute">Communauté</SelectItem>
              <SelectItem value="technique">Technique</SelectItem>
              <SelectItem value="loreteam">Équipe Lore</SelectItem>
              <SelectItem value="dessinateurteam">Équipe Dessinateur</SelectItem>
              <SelectItem value="productionteam">Équipe Production</SelectItem>
              <SelectItem value="socialteam">Équipe Réseaux</SelectItem>
              <SelectItem value="achilleateam">Équipe Achilléa</SelectItem>
              <SelectItem value="azaleeteam">Équipe Azalée</SelectItem>
              <SelectItem value="mediationteam">Cellule de Médiation</SelectItem>
              <SelectItem value="collabteam">Partenaires</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Image à la une</Label>
          <div
            onClick={onImageUpload}
            className={`
              relative w-full h-48 rounded-lg border-2 border-dashed cursor-pointer overflow-hidden group transition-all
              ${featuredImage ? "border-transparent" : "border-border hover:border-rg-rose hover:bg-muted/30"}
            `}
          >
            {isUploading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/30">
                <Loader2 className="size-8 animate-spin text-rg-rose" />
                <span className="text-sm text-muted-foreground mt-2">Upload en cours...</span>
              </div>
            ) : featuredImage ? (
              <>
                <Image
                  src={featuredImage}
                  alt="Aperçu"
                  fill
                  sizes="(max-width: 768px) 100vw, 600px"
                  className="object-cover"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={e => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    <Crop className="size-4 mr-2" />
                    Recadrer
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={e => {
                      e.stopPropagation();
                      onImageUpload();
                    }}
                  >
                    <ImageIcon className="size-4 mr-2" />
                    Changer
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={e => {
                      e.stopPropagation();
                      setFeaturedImage("");
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-2">
                <ImageIcon className="size-10" />
                <span className="text-sm font-medium">Bibliothèque</span>
                <span className="text-xs text-muted-foreground">ou</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={e => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  <Upload className="size-3 mr-2" />
                  Uploader & Recadrer
                </Button>
              </div>
            )}
          </div>
          <Input
            value={featuredImage}
            onChange={e => setFeaturedImage(e.target.value)}
            placeholder="Ou collez une URL ici..."
            className="text-xs text-muted-foreground font-mono"
          />
        </div>
      </div>
    </div>
  );
}
