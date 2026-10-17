"use server";

import { requireEditorOrFail } from "@/lib/auth-helpers";
import { createPostgresClient } from "@rosegriffon/db/service";

// --- Configuration ---

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
// AVIF/HEIC dépendent des codecs de l'OS et ne se décodent pas sous Linux (Vercel).
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_PIXELS = 8192 * 8192;
const STORAGE_BUCKET = "article";

interface ImageVariant {
  suffix: string;
  width: number;
  quality: number;
}

/**
 * Variantes générées pour chaque image uploadée.
 * - full   : hero pleine largeur (max 2400px, qualité 85)
 * - card   : cartes du feed (max 800px, qualité 80)
 * - thumb  : miniatures sidebar/OG (max 400px, qualité 75)
 */
const VARIANTS: ImageVariant[] = [
  { quality: 85, suffix: "", width: 2400 },
  { quality: 80, suffix: "_card", width: 800 },
  { quality: 75, suffix: "_thumb", width: 400 },
];

export interface UploadResult {
  url: string;
  cardUrl: string;
  thumbUrl: string;
  width: number;
  height: number;
}

// --- Helpers internes ---

async function verifyEditorRole(): Promise<{ error?: string }> {
  try {
    await requireEditorOrFail();
    return {};
  } catch (error) {
    return { error: (error as Error).message };
  }
}

function validateFile(file: File): string | null {
  if (!ALLOWED_TYPES.has(file.type)) {
    return `Type de fichier non supporté (${file.type}). Types acceptés : JPEG, PNG, WebP, GIF.`;
  }
  if (file.size > MAX_FILE_SIZE) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return `Fichier trop volumineux (${sizeMB} Mo). Maximum : ${MAX_FILE_SIZE / (1024 * 1024)} Mo.`;
  }
  return null;
}

interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Bound of the box used to fit a variant by width only (aspect ratio kept). */
const MAX_DIMENSION = 16_384;

function isUnsupportedFormat(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "ERR_IMAGE_FORMAT_UNSUPPORTED";
}

async function processAndUpload(
  input: Uint8Array,
  filenameBase: string,
  crop?: CropRect,
): Promise<UploadResult | { error: string }> {
  const supabase = createPostgresClient();

  // Chaque variante part des octets source : Bun.Image décode hors du thread JS.
  const uploads = VARIANTS.map(async variant => {
    const filename = `${filenameBase}${variant.suffix}.webp`;
    const image = new Bun.Image(input, { maxPixels: MAX_PIXELS });
    if (crop) image.extract(crop);
    const bytes = await image
      .resize(variant.width, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: variant.quality })
      .bytes();

    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(filename, bytes, {
      cacheControl: "public, max-age=31536000, immutable",
      contentType: "image/webp",
      upsert: false,
    });

    if (error) {
      console.error(`Storage upload error (${variant.suffix || "full"}):`, error);
      throw new Error(`Upload échoué pour la variante ${variant.suffix || "full"}`);
    }

    return {
      height: image.height,
      url: supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filename).data.publicUrl,
      width: image.width,
    };
  });

  try {
    const [full, card, thumb] = await Promise.all(uploads);
    return { cardUrl: card.url, height: full.height, thumbUrl: thumb.url, url: full.url, width: full.width };
  } catch (error) {
    console.error("Image processing failed:", error);
    if (isUnsupportedFormat(error)) return { error: "Format d'image non pris en charge par le serveur" };
    return { error: error instanceof Error ? error.message : "Échec du traitement de l'image" };
  }
}

async function readDimensions(input: Uint8Array): Promise<{ width: number; height: number } | null> {
  try {
    const { width, height } = await new Bun.Image(input, { maxPixels: MAX_PIXELS }).metadata();
    return width && height ? { height, width } : null;
  } catch {
    return null;
  }
}

// --- Actions publiques ---

/**
 * Upload une image, génère 3 variantes (full 2400px, card 800px, thumb 400px)
 * et retourne les URLs + dimensions.
 */
export async function uploadImage(formData: FormData): Promise<UploadResult | { error: string }> {
  try {
    const file = formData.get("file") as File;
    if (!file) {
      return { error: "Aucun fichier fourni" };
    }

    const validationError = validateFile(file);
    if (validationError) {
      return { error: validationError };
    }

    const authError = await verifyEditorRole();
    if (authError.error) {
      return { error: authError.error };
    }

    const input = new Uint8Array(await file.arrayBuffer());
    if (!(await readDimensions(input))) {
      return { error: "Impossible de lire les dimensions de l'image" };
    }

    return await processAndUpload(input, crypto.randomUUID());
  } catch (error) {
    console.error("Image upload failed:", error);
    return { error: "Échec de l'upload de l'image" };
  }
}

/**
 * Upload une image avec recadrage côté serveur.
 * Les valeurs de crop sont en pourcentages (0-100) des dimensions originales.
 * Génère les mêmes 3 variantes que uploadImage.
 */
export async function uploadImageWithCrop(formData: FormData): Promise<UploadResult | { error: string }> {
  try {
    const file = formData.get("file") as File;
    const cropX = Number.parseFloat(formData.get("cropX") as string);
    const cropY = Number.parseFloat(formData.get("cropY") as string);
    const cropWidth = Number.parseFloat(formData.get("cropWidth") as string);
    const cropHeight = Number.parseFloat(formData.get("cropHeight") as string);

    if (!file) {
      return { error: "Aucun fichier fourni" };
    }

    const validationError = validateFile(file);
    if (validationError) {
      return { error: validationError };
    }

    if ([cropX, cropY, cropWidth, cropHeight].some(Number.isNaN)) {
      return { error: "Données de recadrage invalides" };
    }

    const authError = await verifyEditorRole();
    if (authError.error) {
      return { error: authError.error };
    }

    const input = new Uint8Array(await file.arrayBuffer());
    const metadata = await readDimensions(input);

    if (!metadata) {
      return { error: "Impossible de lire les dimensions de l'image" };
    }

    // Convertir les pourcentages en pixels
    const left = Math.round((cropX / 100) * metadata.width);
    const top = Math.round((cropY / 100) * metadata.height);
    const width = Math.round((cropWidth / 100) * metadata.width);
    const height = Math.round((cropHeight / 100) * metadata.height);

    // Clamper aux limites valides
    const safeLeft = Math.max(0, Math.min(left, metadata.width - 1));
    const safeTop = Math.max(0, Math.min(top, metadata.height - 1));
    const safeWidth = Math.max(1, Math.min(width, metadata.width - safeLeft));
    const safeHeight = Math.max(1, Math.min(height, metadata.height - safeTop));

    const crop = { height: safeHeight, left: safeLeft, top: safeTop, width: safeWidth };
    return await processAndUpload(input, crypto.randomUUID(), crop);
  } catch (error) {
    console.error("Image crop upload failed:", error);
    return { error: "Échec de l'upload de l'image recadrée" };
  }
}
