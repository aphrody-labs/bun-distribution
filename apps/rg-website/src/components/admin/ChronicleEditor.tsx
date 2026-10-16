"use client";

import { Alert, AlertDescription, Button } from "@rosegriffon/ui";
import "react-quill-new/dist/quill.snow.css";

import { AlertCircle, Eye, Save, Send } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { ChronicleMeta } from "@/components/admin/chronicles/ChronicleMeta";
import { ChroniclePreview } from "@/components/admin/chronicles/ChroniclePreview";
import { MediaDialog } from "@/components/admin/media/MediaDialog";

// Interface minimaliste pour ReactQuill
interface QuillInstance {
  getEditor: () => {
    getSelection: (focus?: boolean) => { index: number; length: number };
    insertEmbed: (index: number, type: string, value: string) => void;
    format: (name: string, value: string) => void;
  };
}

const ReactQuill = dynamic(
  async () => {
    const mod = await import("react-quill-new");
    // Handle both ESM and CommonJS default exports
    return mod.default || mod;
  },
  {
    loading: () => <div className="h-[500px] bg-muted animate-pulse rounded-md" />,
    ssr: false,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) as any; // Cast as any because dynamic import typing is complex with react-quill-new

interface ChronicleEditorProps {
  initialData?: {
    title?: string;
    slug?: string;
    excerpt?: string;
    content?: string;
    category?: string;
    featured_image?: string;
    published?: boolean;
  };
  onSave: (data: {
    title: string;
    slug: string;
    excerpt: string;
    content: string;
    category: string;
    featured_image: string;
    published: boolean;
  }) => Promise<void>;
  onCancel: () => void;
}

export function ChronicleEditor({ initialData, onSave, onCancel }: ChronicleEditorProps) {
  const [title, setTitle] = useState(initialData?.title || "");
  const [slug, setSlug] = useState(initialData?.slug || "");
  const [excerpt, setExcerpt] = useState(initialData?.excerpt || "");
  const [category, setCategory] = useState(initialData?.category || "actualites");
  const [featuredImage, setFeaturedImage] = useState(initialData?.featured_image || "");
  const [content, setContent] = useState(initialData?.content || "");
  const [published] = useState(initialData?.published || false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [isMediaDialogOpen, setIsMediaDialogOpen] = useState(false);
  const [isUploadingFeaturedImage, setIsUploadingFeaturedImage] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [hasDraft, setHasDraft] = useState(false);

  const quillRef = useRef<QuillInstance>(null);

  const draftKey = initialData?.slug ? `draft_chronicle_${initialData.slug}` : "draft_chronicle_new";

  useEffect(() => {
    const draft = localStorage.getItem(draftKey);
    if (draft && draft !== (initialData?.content || "")) {
      setHasDraft(true);
    }
  }, [draftKey, initialData]);

  useEffect(() => {
    if (content) {
      localStorage.setItem(draftKey, content);
    }
  }, [content, draftKey]);

  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (!initialData?.slug) {
      const generatedSlug = value
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/[\u0300-\u036F]/g, "")
        .replaceAll(/[^a-z0-9]+/g, "-")
        .replaceAll(/^-|-$/g, "");
      setSlug(generatedSlug);
    }
  };

  const handleMediaInsert = (data: {
    type: "image" | "youtube" | "video" | "emote";
    src: string;
    alt?: string;
    title?: string;
  }) => {
    if (isUploadingFeaturedImage) {
      setFeaturedImage(data.src);
      setIsUploadingFeaturedImage(false);
    } else {
      if (quillRef.current) {
        const quill = quillRef.current.getEditor();
        const range = quill.getSelection(true);

        if (data.type === "image") {
          quill.insertEmbed(range.index, "image", data.src);
        } else if (data.type === "youtube") {
          quill.insertEmbed(range.index, "video", data.src);
        } else if (data.type === "emote") {
          quill.insertEmbed(range.index, "image", data.src);
        }
      }
    }
    setIsMediaDialogOpen(false);
  };

  const validateForm = (): boolean => {
    const newErrors: string[] = [];

    if (!title.trim()) {
      newErrors.push("Le titre est requis");
    }
    if (!slug.trim()) {
      newErrors.push("Le slug est requis");
    }
    if (!excerpt.trim()) {
      newErrors.push("Le résumé est requis");
    }

    if (!content || content === "<p><br></p>" || content.trim().length === 0) {
      newErrors.push("Le contenu est requis");
    }

    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const handleSaveDraft = async () => {
    if (!validateForm()) {
      return;
    }

    setIsSaving(true);
    setErrors([]);
    try {
      await onSave({
        category,
        content,
        excerpt,
        featured_image: featuredImage,
        published: false,
        slug,
        title,
      });
    } catch (error) {
      console.error("Erreur lors de l'enregistrement:", error);
      setErrors(["Échec de l'enregistrement du brouillon"]);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!validateForm()) {
      return;
    }

    setIsSaving(true);
    setErrors([]);
    try {
      await onSave({
        category,
        content,
        excerpt,
        featured_image: featuredImage,
        published: true,
        slug,
        title,
      });
    } catch (error) {
      console.error("Erreur lors de la publication:", error);
      setErrors(["Échec de la publication"]);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (published) {
      await handlePublish();
    } else {
      await handleSaveDraft();
    }
  };

  const modules = {
    toolbar: {
      container: [
        [{ header: [1, 2, 3, 4, 5, 6, false] }],
        ["bold", "italic", "underline", "strike"],
        [{ list: "ordered" }, { list: "bullet" }],
        [{ color: [] }, { background: [] }],
        [{ align: [] }],
        ["link", "image", "video"],
        ["clean"],
      ],
      handlers: {
        image: () => {
          setIsMediaDialogOpen(true);
        },
      },
    },
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
      {/* Alerte erreurs */}
      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>
            <ul className="list-disc list-inside">
              {errors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Alerte brouillon trouvé */}
      {hasDraft && (
        <Alert className="border-sky-500/40 bg-sky-500/10">
          <AlertCircle className="size-4 text-sky-600 dark:text-sky-400" />
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-foreground">
              Un brouillon non enregistré a été trouvé. Voulez-vous le restaurer ?
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 flex-1 text-xs sm:flex-none"
                onClick={() => {
                  const draft = localStorage.getItem(draftKey);
                  if (draft) {
                    setContent(draft);
                    setHasDraft(false);
                  }
                }}
              >
                Restaurer
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-blue-700 hover:bg-blue-100 flex-1 sm:flex-none"
                onClick={() => {
                  localStorage.removeItem(draftKey);
                  setHasDraft(false);
                }}
              >
                Ignorer
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Barre d'actions principale */}
      <div className="flex flex-col gap-3 sm:gap-4 bg-muted/30 p-3 sm:p-4 rounded-lg border">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
          <div className="flex items-center justify-between sm:justify-start gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsPreview(!isPreview)}
              className="flex-1 sm:flex-none"
            >
              <Eye className="size-4 mr-2" />
              {isPreview ? "Éditer" : "Prévisualiser"}
            </Button>

            <div className="hidden h-6 w-px bg-border md:block" />

            <span className="text-xs sm:text-sm text-muted-foreground truncate">
              Catégorie: <span className="font-medium">{category}</span>
            </span>
          </div>

          <div className="grid grid-cols-3 sm:flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={isSaving}
              className="text-xs sm:text-sm"
            >
              Annuler
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSaveDraft}
              disabled={isSaving}
              className="text-xs sm:text-sm"
            >
              <Save className="size-3 sm:h-4 sm:w-4 sm:mr-2" />
              <span className="hidden sm:inline">{isSaving && !published ? "Enregistrement..." : "Brouillon"}</span>
              <span className="sm:hidden">Draft</span>
            </Button>

            <Button
              type="button"
              size="sm"
              onClick={handlePublish}
              disabled={isSaving}
              className="bg-linear-to-r from-rg-rose to-rg-or hover:opacity-90 text-white text-xs sm:text-sm"
            >
              <Send className="size-3 sm:h-4 sm:w-4 sm:mr-2" />
              <span className="hidden sm:inline">{isSaving && published ? "Publication..." : "Publier"}</span>
              <span className="sm:hidden">Pub</span>
            </Button>
          </div>
        </div>
      </div>

      {isPreview ? (
        <ChroniclePreview
          title={title}
          excerpt={excerpt}
          category={category}
          featuredImage={featuredImage}
          content={content}
        />
      ) : (
        <>
          <ChronicleMeta
            title={title}
            onTitleChange={handleTitleChange}
            slug={slug}
            setSlug={setSlug}
            excerpt={excerpt}
            setExcerpt={setExcerpt}
            category={category}
            setCategory={setCategory}
            featuredImage={featuredImage}
            setFeaturedImage={setFeaturedImage}
            onImageUpload={() => {
              setIsUploadingFeaturedImage(true);
              setIsMediaDialogOpen(true);
            }}
          />

          <div className="bg-white rounded-lg border overflow-hidden">
            <ReactQuill
              ref={quillRef}
              theme="snow"
              value={content}
              onChange={setContent}
              modules={modules}
              className="h-[400px] sm:h-[500px] mb-12"
            />
          </div>

          {/* Infos de publication */}
          <div className="bg-muted/30 p-3 sm:p-4 rounded-lg border space-y-2 sm:space-y-3">
            <h3 className="font-semibold text-sm text-foreground/80">État de publication</h3>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-xs sm:text-sm">
              <span className="text-muted-foreground">
                Statut: <span className="font-medium">{published ? "🟢 Publié" : "🟡 Brouillon"}</span>
              </span>
              <span className="text-muted-foreground">
                Caractères: <span className="font-medium">{content.length}</span>
              </span>
            </div>
          </div>
        </>
      )}

      <MediaDialog
        open={isMediaDialogOpen}
        onOpenChange={open => {
          setIsMediaDialogOpen(open);
          if (!open) {
            setIsUploadingFeaturedImage(false);
          }
        }}
        onInsert={handleMediaInsert}
      />
    </form>
  );
}
