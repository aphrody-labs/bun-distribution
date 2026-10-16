"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { useSidebar } from "@rosegriffon/ui";

/**
 * Handler pour la navigation dans la sidebar
 * Améliore l'UX en gérant la fermeture automatique et les animations fluides
 * @returns null - Ce composant ne rend rien visuellement
 */
export default function SidebarNavigationHandler() {
  const sidebar = useSidebar();
  const pathname = usePathname();
  const previousPathnameRef = useRef(pathname);
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Callback optimisé pour fermer la sidebar avec délai pour animation
  const closeSidebarWithDelay = useCallback(() => {
    // Annuler tout timeout précédent
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Ajouter un léger délai pour permettre l'animation de clic
    timeoutRef.current = setTimeout(() => {
      sidebar.setOpenMobile(false);
    }, 150); // 150ms permet de voir le feedback visuel du clic
  }, [sidebar]);

  useEffect(() => {
    // Ne fermer que si la route a vraiment changé
    if (pathname !== previousPathnameRef.current) {
      previousPathnameRef.current = pathname;

      // Fermer uniquement sur mobile pour meilleure UX desktop
      if (sidebar.isMobile) {
        closeSidebarWithDelay();
      }
    }

    // Cleanup
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [pathname, sidebar.isMobile, closeSidebarWithDelay]);

  // Gérer la touche Escape pour fermer la sidebar (a11y)
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && sidebar.isMobile) {
        sidebar.setOpenMobile(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [sidebar]);

  return null;
}
