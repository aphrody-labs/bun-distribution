import Link from "next/link";
import { T } from "@/components/T";
import { LinkPager as PortableLinkPager } from "@shenron/ui/navigation/LinkPager";
import type { ComponentProps } from "react";

;

/** Next.js links and site translations for the portable link pager. */
export function LinkPager(props: Omit<ComponentProps<typeof PortableLinkPager>, "linkComponent" | "previousLabel" | "nextLabel" | "positionLabel">) {
  return <PortableLinkPager {...props} linkComponent={Link} previousLabel={<T k="common.previous" />} nextLabel={<T k="common.next" />} positionLabel={<T k="kit.pager.position" values={{ page: props.page, pages: props.pages }} />} />;
}