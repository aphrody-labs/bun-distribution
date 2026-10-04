import type { ComponentType, ReactNode } from "react";

type UiLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  title?: string;
  onClick?: () => void;
  tabIndex?: number;
  "aria-hidden"?: boolean;
  rel?: string;
  "aria-current"?: "page";
};

export type UiLinkComponent = ComponentType<UiLinkProps> | "a";
