import Image from "next/image";
import type React from "react";

interface FusionBlockProps {
  isImageLeft: boolean;
  image?: string;
  children: React.ReactNode;
  imageStyle?: React.CSSProperties;
  imageOverlay?: React.ReactNode;
  isPriority?: boolean;
}

export default function FusionBlock({
  isImageLeft,
  image,
  children,
  imageStyle,
  imageOverlay,
  isPriority = false,
}: FusionBlockProps) {
  const imageUrl = image || "/RG_Banner.webp";

  const imageBlock = (
    <div className="w-full md:w-1/2 h-[240px] sm:h-[280px] md:h-[320px] lg:h-[380px] rounded-2xl md:rounded-none overflow-hidden relative bg-surface-container-low flex items-center justify-center group-hover:shadow-xl transition-shadow duration-300">
      <Image
        src={imageUrl}
        alt="Présentation Rose Griffon"
        fill
        className="object-center object-cover group-hover:scale-105 transition-transform duration-500"
        sizes="(max-width: 768px) 100vw, 50vw"
        style={imageStyle}
        priority={isPriority}
        loading={isPriority ? undefined : "lazy"}
      />
      {imageOverlay && <div className="absolute inset-0 flex items-center justify-center">{imageOverlay}</div>}
    </div>
  );

  const contentBlock = (
    <div className="w-full md:w-1/2 bg-surface-container-lowest text-foreground p-5 sm:p-6 md:p-7 lg:p-8 xl:p-10 flex items-center rounded-2xl md:rounded-none shadow-sm group-hover:shadow-md transition-shadow duration-300 overflow-hidden">
      {children}
    </div>
  );

  return (
    <div
      className={`flex flex-col w-full gap-3 sm:gap-4 md:gap-0 group border border-outline-variant/20 hover:border-primary/40 shadow-sm hover:shadow-xl transition-all duration-300 md:min-h-[320px] lg:min-h-[380px] rounded-2xl md:rounded-3xl overflow-hidden ${isImageLeft ? "md:flex-row" : "md:flex-row-reverse"}`}
    >
      {imageBlock}
      {contentBlock}
    </div>
  );
}
