"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { domaineDeLaRoute, type Domaine } from "../config/navigation";
import { BASE_ESPORT, BASE_WIKI } from "../config/routes";

export interface UniverseSwitchProps extends React.ComponentProps<"nav"> {
  className?: string;
}

interface UniverseTab {
  id: Domaine;
  label: string;
  logo: string;
  path: string;
  activeClass: string;
  hoverClass: string;
}

export function UniverseSwitch({ className, ...props }: UniverseSwitchProps) {
  const pathname = usePathname() || "/";
  const activeDomaine = domaineDeLaRoute(pathname);

  const tabs: UniverseTab[] = [
    {
      id: "association",
      label: "Rose Griffon",
      logo: "/RG_Logo_V2.5.webp",
      path: "/",
      activeClass: "bg-rose-griffon/20 border-rose-griffon/60 shadow-xs ring-1 ring-rose-griffon/50 scale-105",
      hoverClass: "hover:bg-rose-griffon/10 hover:border-rose-griffon/30",
    },
    {
      id: "wiki",
      label: "Azalée",
      logo: "/RG_Azalee-logo.webp",
      path: BASE_WIKI,
      activeClass: "bg-secondary/20 border-secondary/60 shadow-xs ring-1 ring-secondary/50 scale-105",
      hoverClass: "hover:bg-secondary/10 hover:border-secondary/30",
    },
    {
      id: "esport",
      label: "Achilléa",
      logo: "/achillea/logo1.svg",
      path: BASE_ESPORT,
      activeClass:
        "bg-achillea-violet/20 dark:bg-achillea-lime/20 border-achillea-violet/60 dark:border-achillea-lime/60 shadow-xs ring-1 ring-achillea-violet/50 dark:ring-achillea-lime/50 scale-105",
      hoverClass:
        "hover:bg-achillea-violet/10 dark:hover:bg-achillea-lime/10 hover:border-achillea-violet/30 dark:hover:border-achillea-lime/30",
    },
  ];

  return (
    <nav
      aria-label="Sélection de l'univers"
      className={`inline-flex items-center gap-1 p-1 rounded-full bg-surface-container-high/70 border border-outline-variant/20 backdrop-blur-md ${
        className ?? ""
      }`}
      {...props}
    >
      {tabs.map(tab => {
        const isActive = activeDomaine === tab.id;
        return (
          <Link
            key={tab.id}
            href={tab.path}
            aria-label={tab.label}
            title={tab.label}
            aria-current={isActive ? "page" : undefined}
            className={`relative size-8 rounded-full flex items-center justify-center p-1 border transition-all duration-200 select-none touch-manipulation ${
              isActive
                ? `${tab.activeClass} opacity-100`
                : `border-transparent opacity-60 hover:opacity-100 ${tab.hoverClass}`
            }`}
          >
            <div className="relative size-5 shrink-0">
              <Image src={tab.logo} alt={tab.label} fill sizes="20px" className="object-contain" />
            </div>
            <span className="sr-only">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export default UniverseSwitch;
