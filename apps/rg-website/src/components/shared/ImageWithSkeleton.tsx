"use client";

import React, { useState } from "react";

import { Skeleton, StorageImage } from "@rosegriffon/ui";

const PLACEHOLDER = "/RG_Logo_V2.5.webp";

// Image component with skeleton loader.
//
// Les avatars d'équipe pointent vers cdn.discordapp.com, qui les sert déjà en
// webp dimensionné via `?size=`. On garde `unoptimized` : les ré-encoder sur
// notre VPS coûterait du CPU sans rien gagner en poids. Fallback propre vers le
// logo RG si l'URL source casse.
const ImageWithSkeleton = React.memo(
  ({ src, alt, priority = false }: { src: string; alt: string; priority?: boolean }) => {
    const [isLoading, setIsLoading] = useState(true);

    return (
      <>
        {isLoading && <Skeleton className="absolute inset-0 w-full h-full rounded-full" />}
        <StorageImage
          src={src}
          alt={alt}
          fill
          className="object-cover"
          onLoad={() => setIsLoading(false)}
          priority={priority}
          loading={priority ? "eager" : "lazy"}
          sizes="(max-width: 768px) 100px, 144px"
          unoptimized
          fallback={PLACEHOLDER}
        />
      </>
    );
  },
);

export default ImageWithSkeleton;
