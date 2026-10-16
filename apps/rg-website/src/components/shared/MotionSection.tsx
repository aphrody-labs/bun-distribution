"use client";

import { motion, useReducedMotion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";

interface MotionSectionProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  id?: string;
  "aria-labelledby"?: string;
}

// MD3 emphasized-decelerate easing
const EMPHASIZED_DECELERATE: [number, number, number, number] = [0.05, 0.7, 0.1, 1];

export function MotionSection({
  children,
  className,
  style,
  id,
  "aria-labelledby": ariaLabelledBy,
}: MotionSectionProps) {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return (
      <section id={id} className={className} style={style} aria-labelledby={ariaLabelledBy}>
        {children}
      </section>
    );
  }

  return (
    <motion.section
      id={id}
      className={className}
      style={style}
      aria-labelledby={ariaLabelledBy}
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ margin: "-50px", once: true }}
      transition={{ duration: 0.5, ease: EMPHASIZED_DECELERATE }}
    >
      {children}
    </motion.section>
  );
}

export default MotionSection;
