import Image from "next/image";
import Link from "next/link";
import { assetUrl } from "@/lib/assets";
import { MangaCard as PortableMangaCard, type MangaCardProps, type UiCardImageProps } from "@shenron/ui/public/MangaCard";

export { CardGrid, SocialCounts } from "@shenron/ui/public/MangaCard";
;

function renderImage({ src, alt, priority, sizes, className }: UiCardImageProps) {
  return <Image src={src} alt={alt} fill sizes={sizes} priority={priority} className={className} />;
}

/** Next.js image and link adapters for the portable content card. */
export function MangaCard(props: Omit<MangaCardProps, "linkComponent" | "renderImage" | "resolveImage">) {
  return <PortableMangaCard {...props} linkComponent={Link} renderImage={renderImage} resolveImage={assetUrl} />;
}