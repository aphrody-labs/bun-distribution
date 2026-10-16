// SPDX-License-Identifier: Apache-2.0 AND MIT
// Material Design 3 Avatar primitive built on Base UI (@base-ui/react/avatar).
"use client";

import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { forwardRef } from "react";

import { withClassName } from "./base-ui";

const avatarVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center overflow-hidden font-medium text-label-large",
  {
    variants: {
      size: {
        xs: "size-6 text-[10px]",
        sm: "size-8 text-xs",
        md: "size-10 text-sm",
        lg: "size-12 text-base",
        xl: "size-16 text-xl",
        "2xl": "size-20 text-2xl",
      },
      shape: {
        circle: "rounded-full",
        square: "rounded-medium",
      },
    },
    defaultVariants: {
      size: "md",
      shape: "circle",
    },
  },
);

export type AvatarRootProps = AvatarPrimitive.Root.Props & VariantProps<typeof avatarVariants>;

export const AvatarRoot = forwardRef<HTMLSpanElement, AvatarRootProps>(
  ({ className, size, shape, ...props }, ref) => (
    <AvatarPrimitive.Root
      ref={ref}
      className={withClassName(
        clsx(avatarVariants({ size, shape }), "bg-primary-container text-on-primary-container"),
        className,
      )}
      data-m3-component="Avatar"
      {...props}
    />
  ),
);
AvatarRoot.displayName = "AvatarRoot";

export type AvatarImageProps = AvatarPrimitive.Image.Props;

export const AvatarImage = forwardRef<HTMLImageElement, AvatarImageProps>(
  ({ className, ...props }, ref) => (
    <AvatarPrimitive.Image
      ref={ref}
      className={withClassName("size-full object-cover", className)}
      {...props}
    />
  ),
);
AvatarImage.displayName = "AvatarImage";

export type AvatarFallbackProps = AvatarPrimitive.Fallback.Props;

export const AvatarFallback = forwardRef<HTMLDivElement, AvatarFallbackProps>(
  ({ className, ...props }, ref) => (
    <AvatarPrimitive.Fallback
      ref={ref}
      className={withClassName(
        "flex size-full items-center justify-center bg-inherit text-inherit",
        className,
      )}
      {...props}
    />
  ),
);
AvatarFallback.displayName = "AvatarFallback";

export interface AvatarProps extends AvatarRootProps {
  src?: string;
  alt?: string;
  fallback?: React.ReactNode;
}

/** Pre-composed M3 Avatar with automatic image and fallback. */
export function Avatar({ src, alt, fallback, size, shape, ...props }: AvatarProps) {
  return (
    <AvatarRoot size={size} shape={shape} {...props}>
      {src && <AvatarImage src={src} alt={alt} />}
      <AvatarFallback>{fallback ?? (alt ? alt.slice(0, 2).toUpperCase() : "?")}</AvatarFallback>
    </AvatarRoot>
  );
}

Avatar.Root = AvatarRoot;
Avatar.Image = AvatarImage;
Avatar.Fallback = AvatarFallback;
