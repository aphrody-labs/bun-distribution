"use client";

import { motion, useReducedMotion, useScroll, useSpring } from "motion/react";

/**
 * Barre de progression scroll fixée en haut du viewport. Couleur signature
 * Rose Griffon (or `#d4af37`). Springée pour un mouvement organique. Respecte
 * `prefers-reduced-motion` → barre instantanée sans spring.
 */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const reduced = useReducedMotion();
  const scaleX = useSpring(scrollYProgress, {
    damping: reduced ? 100 : 35,
    restDelta: 0.001,
    stiffness: reduced ? 1000 : 280,
  });

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed left-0 right-0 top-0 z-50 h-1 origin-left bg-gradient-to-r from-[#d4af37] via-[#e8c668] to-[#a14b3f] shadow-[0_1px_4px_rgba(0,0,0,0.4)]"
      style={{ scaleX }}
    />
  );
}
