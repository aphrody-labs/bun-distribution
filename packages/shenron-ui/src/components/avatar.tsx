"use client";

import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import type * as React from "react";

import { cn } from "../lib/utils";

function Avatar({
  className,
  variant = "scouter",
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & {
  variant?: "scouter" | "capsule" | "comic";
}) {
  const variants = {
    scouter:
      "border-2 border-green-500/80 shadow-[0_0_10px_rgba(34,197,94,0.3)] bg-[#051206]",
    capsule:
      "border-2 border-dbz-blue shadow-[0_0_10px_rgba(0,180,255,0.3)] bg-[#060c18]",
    comic: "border-2 border-black shadow-[2px_2px_0px_#000] bg-[#121218]",
  };

  return (
    <AvatarPrimitive.Root
      className={cn(
        "relative flex size-10 shrink-0 overflow-hidden rounded-full outline-none",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      className={cn(
        "aspect-square size-full object-cover object-top",
        className,
      )}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      className={cn(
        "flex size-full items-center justify-center font-saiyan font-bold text-xs uppercase text-white/80",
        className,
      )}
      {...props}
    />
  );
}

export { Avatar, AvatarImage, AvatarFallback };
