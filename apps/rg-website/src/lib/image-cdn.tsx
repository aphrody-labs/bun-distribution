/**
 * `next/image` with a free-tier guardrail on Vercel Image Optimization.
 *
 * `next.config.ts` aliases `next/image` to this module (webpack, the bundler of
 * both `dev` and `build`), so every `import Image from "next/image"` of the app
 * and of the transpiled workspace packages goes through it.
 *
 * Vercel Hobby includes 5,000 image transformations a month. The wiki alone
 * renders thousands of distinct game textures (faces, emblems, icons) decoded
 * live by `nie-model-serve` behind `cdn.rosegriffon.fr`, plus Discord avatars,
 * Twitch thumbnails and the official encyclopedia: optimizing them would burn
 * the quota in days. Those images are already sized by their own CDN, so they
 * are served as is (`unoptimized`).
 *
 * Only first-party uploads keep the optimizer: static imports, relative paths
 * of `public/` (and the `/storage/v1` rewrite) and Supabase Storage, where the
 * transformation also spares Supabase egress. An explicit `unoptimized` or
 * `loader` prop always wins. See docs/aphrody/reference/infra/rg-free-tier-allocation.md.
 */
import NextImage, { getImageProps as nextGetImageProps } from "next/dist/api/image";
import type { ImageProps } from "next/image";

/** Hosts whose images are worth a Vercel transformation (first-party uploads). */
const OPTIMIZED_HOST_SUFFIXES = [".supabase.co"];

export function isOptimizedImageSource(src: ImageProps["src"]): boolean {
  if (typeof src !== "string") return true;
  if (src.startsWith("/") && !src.startsWith("//")) return !src.startsWith("/api/");
  try {
    const { hostname } = new URL(src);
    return OPTIMIZED_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

function withGuardrail(props: ImageProps): ImageProps {
  if (props.unoptimized !== undefined || props.loader) return props;
  return isOptimizedImageSource(props.src) ? props : { ...props, unoptimized: true };
}

export default function Image(props: ImageProps) {
  return <NextImage {...withGuardrail(props)} />;
}

export function getImageProps(props: ImageProps) {
  return nextGetImageProps(withGuardrail(props));
}

export type { ImageLoader, ImageLoaderProps, ImageProps, StaticImageData } from "next/image";
