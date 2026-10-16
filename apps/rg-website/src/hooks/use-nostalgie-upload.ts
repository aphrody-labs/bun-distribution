import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { compressImage, fileToDataURL } from "@/lib/nostalgie-utils";

export const useNostalgieUpload = () => {
  const [image, setImage] = useState<string | null>(null);
  const [tempImage, setTempImage] = useState<string | null>(null);
  const [showCropDialog, setShowCropDialog] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Format invalide. Veuillez sélectionner une image.");
      return;
    }

    try {
      const compressed = await compressImage(file);
      const dataUrl = await fileToDataURL(compressed);
      setTempImage(dataUrl);
      setShowCropDialog(true);
    } catch {
      toast.error("Erreur lors du traitement de l'image");
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) {
        processFile(file);
      }
    },
    [processFile],
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        processFile(file);
      }
    },
    [processFile],
  );

  const handleCropComplete = useCallback((croppedImage: string) => {
    setImage(croppedImage);
    setTempImage(null);
    setShowCropDialog(false);
    toast.success("Image ajoutée avec succès");
  }, []);

  const handleCloseDialog = useCallback(() => {
    setTempImage(null);
    setShowCropDialog(false);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, []);

  const handleRemoveImage = useCallback(() => {
    setImage(null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    toast.info("Image supprimée");
  }, []);

  const reset = useCallback(() => {
    setImage(null);
    setTempImage(null);
    setShowCropDialog(false);
    setIsDragging(false);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, []);

  return {
    handleCloseDialog,
    handleCropComplete,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileInput,
    handleRemoveImage,
    image,
    inputRef,
    isDragging,
    reset,
    showCropDialog,
    tempImage,
  };
};
