"use client";

import { useEffect, useRef } from "react";

import { useSidebar } from "@rosegriffon/ui";

/**
 * Détecte les swipes depuis le bord gauche de l'écran pour ouvrir la sidebar sur mobile
 */
export default function EdgeSwipeDetector() {
  const { setOpenMobile, openMobile, isMobile } = useSidebar();
  const touchStartX = useRef<number>(0);
  const touchStartY = useRef<number>(0);
  const touchEndX = useRef<number>(0);
  const touchEndY = useRef<number>(0);
  const isEdgeSwipe = useRef<boolean>(false);

  useEffect(() => {
    if (!isMobile) {
      return;
    }

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) {
        return;
      }
      touchStartX.current = touch.clientX;
      touchStartY.current = touch.clientY;

      // Déterminer si le toucher commence depuis le bord gauche (zone de 30px)
      isEdgeSwipe.current = touchStartX.current < 30 && !openMobile;
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) {
        return;
      }
      touchEndX.current = touch.clientX;
      touchEndY.current = touch.clientY;
    };

    const handleTouchEnd = () => {
      if (!isEdgeSwipe.current) {
        return;
      }

      const deltaX = touchEndX.current - touchStartX.current;
      const deltaY = touchEndY.current - touchStartY.current;

      // Vérifier que c'est un mouvement horizontal (plus large que vertical)
      const isHorizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY);

      // Swipe vers la droite (au moins 50px)
      const isRightSwipe = deltaX > 50;

      if (isHorizontalSwipe && isRightSwipe) {
        setOpenMobile(true);
      }

      // Reset
      isEdgeSwipe.current = false;
      touchStartX.current = 0;
      touchStartY.current = 0;
      touchEndX.current = 0;
      touchEndY.current = 0;
    };

    // Ajouter les listeners sur le document pour capturer depuis n'importe où
    document.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    document.addEventListener("touchmove", handleTouchMove, { passive: true });
    document.addEventListener("touchend", handleTouchEnd);

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isMobile, setOpenMobile, openMobile]);

  return null; // Composant sans UI
}
