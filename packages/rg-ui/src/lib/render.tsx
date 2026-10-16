"use client";

import { useRender } from "@base-ui/react/use-render";
import {
  Children,
  isValidElement,
  type ComponentProps,
  type ElementType,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";

export type PrimitiveProps<T extends ElementType> = Omit<ComponentProps<T>, "className"> & {
  className?: string;
  asChild?: boolean;
};

export function childRender(asChild: boolean | undefined, children: ReactNode): ReactElement | undefined {
  if (!asChild) return undefined;
  const child = Children.only(children);
  if (!isValidElement(child)) throw new Error("asChild requires one React element");
  return child;
}

export function Slot({
  children,
  ref,
  ...props
}: HTMLAttributes<HTMLElement> & { children?: ReactNode; ref?: Ref<HTMLElement> }) {
  return useRender({ render: childRender(true, children), ref, props });
}
