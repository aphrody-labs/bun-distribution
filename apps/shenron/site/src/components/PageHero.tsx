import Image from "next/image";
import { PageHero as PortablePageHero } from "@shenron/ui/layout/PageHero";
import type { ComponentProps } from "react";

export function PageHero(props: Omit<ComponentProps<typeof PortablePageHero>, "renderImage">) {
  return (
    <PortablePageHero
      {...props}
      renderImage={({ src, alt, className }) => (
        <Image src={src} alt={alt} fill priority sizes="100vw" className={className} />
      )}
    />
  );
}
