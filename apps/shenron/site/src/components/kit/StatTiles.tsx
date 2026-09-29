import Link from "next/link";
import { StatTiles as PortableStatTiles } from "@shenron/ui/public/StatTiles";
import type { ComponentProps } from "react";

;

export function StatTiles(props: Omit<ComponentProps<typeof PortableStatTiles>, "linkComponent">) {
  return <PortableStatTiles {...props} linkComponent={Link} />;
}
