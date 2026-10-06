"use client";
import * as React from "react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import type { HTMLMotionProps, Variants } from "motion/react";
import { m3Easings, m3Durations } from "../easings";
import { motionVariants, useM3ReducedMotion } from "../hooks/useM3ReducedMotion";

export interface M3ListStaggerProps {
  /**
   * Delay between each child item entering the scene (seconds).
   * @default 0.05
   */
  staggerDelay?: number;
  /**
   * Delay before the stagger sequence starts (seconds).
   * @default 0
   */
  delayChildren?: number;
  /**
   * If true, items animate on initial render.
   * @default true
   */
  appear?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export interface M3ListStaggerItemProps extends HTMLMotionProps<"div"> {
  children?: React.ReactNode;
}

const containerVariants: Variants = {
  hidden: {},
  visible: (_custom: { staggerDelay: number; delayChildren: number }) => ({
    transition: {
      staggerChildren: _custom.staggerDelay,
      delayChildren: _custom.delayChildren,
    },
  }),
  exit: {},
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      ease: m3Easings.emphasizedDecelerate,
      duration: m3Durations.medium2,
    },
  },
  exit: {
    opacity: 0,
    y: 4,
    transition: {
      ease: m3Easings.emphasizedAccelerate,
      duration: m3Durations.short3,
    },
  },
};

/**
 * M3ListStagger — stagger container for list-item enter/exit animations.
 *
 * Usage:
 *   <M3ListStagger>
 *     {items.map(item => <M3ListStaggerItem key={item.id}>{item.label}</M3ListStaggerItem>)}
 *   </M3ListStagger>
 */
export const M3ListStagger = React.forwardRef<HTMLDivElement, M3ListStaggerProps>(
  ({ staggerDelay = 0.05, delayChildren = 0, appear = true, children, className, style }, ref) => {
    const reduced = useM3ReducedMotion();
    return (
      <motion.div
        ref={ref}
        className={className}
        style={style}
        variants={motionVariants(containerVariants, reduced)}
        initial={appear && !reduced ? "hidden" : false}
        animate="visible"
        exit="exit"
        custom={{ staggerDelay, delayChildren }}
      >
        <AnimatePresence initial={appear && !reduced}>{children}</AnimatePresence>
      </motion.div>
    );
  },
);

M3ListStagger.displayName = "M3ListStagger";

/**
 * M3ListStaggerItem — a single animated item inside M3ListStagger.
 * Must be a direct or indirect descendant of M3ListStagger to inherit variants.
 */
export const M3ListStaggerItem = React.forwardRef<HTMLDivElement, M3ListStaggerItemProps>(
  ({ children, style, ...props }, ref) => {
    const present = useIsPresent();
    const reduced = useM3ReducedMotion();
    return (
      <motion.div
        ref={ref}
        variants={motionVariants(itemVariants, reduced)}
        style={{ willChange: "opacity, transform", ...style }}
        {...props}
        inert={!present || props.inert}
        aria-hidden={!present || props["aria-hidden"]}
      >
        {children}
      </motion.div>
    );
  },
);

M3ListStaggerItem.displayName = "M3ListStaggerItem";
