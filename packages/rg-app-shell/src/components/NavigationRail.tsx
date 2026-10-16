"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavigationRail as UiNavigationRail, NavigationRailItem } from "@rosegriffon/ui";
import { itemsDeNavigation, estItemActif, type NavItem } from "../config/navigation";
import { iconMap } from "../lib/icons";
import { traduireNav } from "../lib/translations";

export interface NavigationRailProps {
  items?: NavItem[];
  isAdmin?: boolean;
  t?: (key: string) => string;
  renderIcon?: (item: NavItem) => React.ReactNode;
  className?: string;
}

export function NavigationRail({ items, isAdmin = false, t, renderIcon, className }: NavigationRailProps = {}) {
  const pathname = usePathname() || "/";
  const resolvedItems = items ?? itemsDeNavigation();

  const filteredNavItems = resolvedItems.filter(item => {
    if (item.adminOnly) {
      return isAdmin;
    }
    return true;
  });

  return (
    <UiNavigationRail
      aria-label="Navigation principale"
      className={`fixed left-0 top-14 bottom-0 z-50 flex overflow-y-auto border-r border-outline-variant/10 ${className ?? ""}`}
    >
      {filteredNavItems.map(item => {
        const LucideIcon = iconMap[item.icon];
        const isActive = estItemActif(pathname, item);
        const href = item.groupOnly ? (item.children?.[0]?.path ?? item.path) : item.path;

        const customIcon = renderIcon ? renderIcon(item) : null;
        const icon = customIcon ?? (LucideIcon ? <LucideIcon size={24} /> : null);

        return (
          <Link key={item.path} href={href} passHref legacyBehavior>
            <NavigationRailItem active={isActive} icon={icon} label={traduireNav(item.label, t)} />
          </Link>
        );
      })}
    </UiNavigationRail>
  );
}

export { NavigationRail as AzaleeNavigationRail };
export default NavigationRail;
