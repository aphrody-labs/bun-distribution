import Link from "next/link";
import { EmptyState as PortableEmptyState } from "@shenron/ui/public/EmptyState";
import type { ComponentProps } from "react";

;

export function EmptyState(props: Omit<ComponentProps<typeof PortableEmptyState>, "linkComponent">) {
  return <PortableEmptyState {...props} linkComponent={Link} />;
}
