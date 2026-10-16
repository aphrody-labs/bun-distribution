// SPDX-License-Identifier: Apache-2.0
"use client";

import { forwardRef, type CSSProperties, type ImgHTMLAttributes } from "react";

export type StaticImageData = {
  src: string;
  height: number;
  width: number;
  blurDataURL?: string;
  blurWidth?: number;
  blurHeight?: number;
};

export interface ImageProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "width" | "height" | "loading"
> {
  src: string | StaticImageData;
  alt: string;
  width?: number | `${number}`;
  height?: number | `${number}`;
  fill?: boolean;
  quality?: number | `${number}`;
  priority?: boolean;
  loading?: "lazy" | "eager";
  placeholder?: "blur" | "empty" | `data:image/${string}`;
  blurDataURL?: string;
  unoptimized?: boolean;
  sizes?: string;
}

export function getImageProps(props: ImageProps): {
  props: ImgHTMLAttributes<HTMLImageElement>;
} {
  const {
    src,
    alt,
    width,
    height,
    fill,
    priority,
    loading,
    placeholder: _placeholder,
    blurDataURL: _blurDataURL,
    unoptimized: _unoptimized,
    quality: _quality,
    style,
    ...rest
  } = props;

  const resolvedSrc = typeof src === "string" ? src : src?.src || "";
  const resolvedWidth = typeof src === "object" && !width ? src.width : width;
  const resolvedHeight =
    typeof src === "object" && !height ? src.height : height;

  const computedStyle: CSSProperties = {
    ...style,
  };

  if (fill) {
    computedStyle.position = "absolute";
    computedStyle.height = "100%";
    computedStyle.width = "100%";
    computedStyle.left = 0;
    computedStyle.top = 0;
    computedStyle.right = 0;
    computedStyle.bottom = 0;
    computedStyle.objectFit = computedStyle.objectFit || "cover";
  }

  return {
    props: {
      src: resolvedSrc,
      alt,
      width: fill ? undefined : resolvedWidth,
      height: fill ? undefined : resolvedHeight,
      loading: priority ? "eager" : loading || "lazy",
      fetchPriority: priority ? "high" : "auto",
      style: computedStyle,
      ...rest,
    },
  };
}

export const Image = forwardRef<HTMLImageElement, ImageProps>(
  function Image(props, ref) {
    const { props: imgProps } = getImageProps(props);
    return <img ref={ref} alt={imgProps.alt} {...imgProps} />;
  },
);

export default Image;
