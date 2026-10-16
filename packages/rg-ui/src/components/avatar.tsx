"use client";

import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { childRender, type PrimitiveProps } from "../lib/render";

import { cn } from "../lib/utils";

function Avatar({ className, asChild, children, ...props }: PrimitiveProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      render={childRender(asChild, children)}
      data-slot="avatar"
      className={cn("relative flex size-8 shrink-0 overflow-hidden rounded-full", className)}
      {...props}
    >
      {asChild ? undefined : children}
    </AvatarPrimitive.Root>
  );
}

function AvatarImage({ className, asChild, children, ...props }: PrimitiveProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      render={childRender(asChild, children)}
      data-slot="avatar-image"
      className={cn("aspect-square size-full", className)}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  asChild,
  children,
  delayMs,
  ...props
}: PrimitiveProps<typeof AvatarPrimitive.Fallback> & { delayMs?: number }) {
  return (
    <AvatarPrimitive.Fallback
      delay={delayMs}
      render={childRender(asChild, children)}
      data-slot="avatar-fallback"
      className={cn("bg-muted flex size-full items-center justify-center rounded-full", className)}
      {...props}
    >
      {asChild ? undefined : children}
    </AvatarPrimitive.Fallback>
  );
}

export { Avatar, AvatarFallback, AvatarImage };
