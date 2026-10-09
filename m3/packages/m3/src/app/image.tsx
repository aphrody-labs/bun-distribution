// SPDX-License-Identifier: Apache-2.0
// `next/image`: an `<img>` with intrinsic size from static imports (`{ src, width, height }`), lazy
// loading and `priority`. Images are served as built; there is no resizing service.
import type { CSSProperties, ImgHTMLAttributes, Ref } from "react";

export interface StaticImageData {
  src: string;
  width?: number;
  height?: number;
  blurDataURL?: string;
}

export interface ImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height"> {
  src: string | StaticImageData;
  alt: string;
  width?: number | `${number}`;
  height?: number | `${number}`;
  /** Fill the parent (which must be positioned). */
  fill?: boolean;
  /** Load eagerly with high fetch priority (LCP images). */
  priority?: boolean;
  quality?: number;
  placeholder?: "blur" | "empty";
  blurDataURL?: string;
  unoptimized?: boolean;
  loader?: (props: { src: string; width: number; quality?: number }) => string;
  ref?: Ref<HTMLImageElement>;
}

const FILL: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%" };

export default function Image({
  src,
  alt,
  width,
  height,
  fill,
  priority,
  quality,
  placeholder,
  blurDataURL,
  unoptimized: _unoptimized,
  loader,
  style,
  loading,
  ...rest
}: ImageProps) {
  const data = typeof src === "string" ? { src } : src;
  const w = fill ? undefined : Number(width ?? data.width) || undefined;
  const h = fill ? undefined : Number(height ?? data.height) || undefined;
  const url = loader && w ? loader({ src: data.src, width: w, quality }) : data.src;
  const blur = placeholder === "blur" ? (blurDataURL ?? data.blurDataURL) : undefined;
  const merged: CSSProperties = {
    ...(fill ? FILL : undefined),
    ...(blur ? { backgroundImage: `url(${JSON.stringify(blur)})`, backgroundSize: "cover" } : undefined),
    ...style,
  };
  return (
    <img
      {...rest}
      src={url}
      alt={alt}
      width={w}
      height={h}
      loading={priority ? "eager" : (loading ?? "lazy")}
      fetchPriority={priority ? "high" : rest.fetchPriority}
      decoding="async"
      style={merged}
    />
  );
}
