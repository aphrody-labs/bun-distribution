"use client";
import type { ComponentProps } from "react";
import { Slot } from "../lib/render";
function AspectRatio({
  ratio = 1,
  asChild,
  style,
  ...props
}: ComponentProps<"div"> & { ratio?: number; asChild?: boolean }) {
  if (!Number.isFinite(ratio) || ratio <= 0) throw new Error("AspectRatio ratio must be positive");
  const Component = asChild ? Slot : "div";
  return <Component data-slot="aspect-ratio" style={{ aspectRatio: ratio, ...style }} {...props} />;
}
export { AspectRatio };
