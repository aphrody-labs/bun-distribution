"use client";

import { useHydrated } from "@/hooks/use-hydrated";

import { useTheme } from "@/contexts/theme-context";
import { cn } from "@/lib/utils";

export default function PfpThemeImage() {
  const { theme } = useTheme();
  const mounted = useHydrated();

  // Images par défaut
  const royImage = "/avatarRG/tutoBleu.webp";
  const gaelleImage = "/avatarRG/tutoRouge.webp";

  // Si pas monté, afficher une image par défaut (Roy) pour éviter le layout shift
  const currentImage = !mounted ? royImage : theme === "gaelle" ? gaelleImage : royImage;

  return (
    <div className="hidden lg:flex items-center justify-center relative h-[600px] w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={currentImage}
        alt="Rose Griffon Illustration"
        className={cn(
          "w-full h-full object-contain transition-opacity duration-500",
          mounted ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
