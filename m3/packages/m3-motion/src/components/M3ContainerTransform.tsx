import * as React from "react";
import { motion } from "motion/react";
import type { HTMLMotionProps, Transition, MotionStyle } from "motion/react";
import { m3Springs } from "../springs";
import { m3Easings } from "../easings";
import { useM3ReducedMotion } from "../hooks/useM3ReducedMotion";

export interface M3ContainerTransformProps extends HTMLMotionProps<"div"> {
  /**
   * Shared identifier linking the starting container (e.g., card) and ending container (e.g., detail page).
   */
  layoutId?: string;
  /**
   * Speed preset to use for the morphing animation.
   * @default "default"
   */
  speed?: "fast" | "default" | "slow";
  /**
   * If true, renders the expanded container state.
   * @default false
   */
  isExpanded?: boolean;
}

export interface M3ContainerTransformContextValue {
  isExpanded: boolean;
  speed: "fast" | "default" | "slow";
}

export const M3ContainerTransformContext =
  React.createContext<M3ContainerTransformContextValue | null>(null);

/**
 * Helper function to generate spec-compliant cross-fade timings.
 */
function getDefaultTransition(isActive: boolean, speed: "fast" | "default" | "slow"): Transition {
  if (speed === "fast") {
    return isActive
      ? { delay: 0.05, duration: 0.15, ease: m3Easings.emphasizedDecelerate }
      : { duration: 0.08, ease: m3Easings.emphasizedAccelerate };
  }
  if (speed === "slow") {
    return isActive
      ? { delay: 0.2, duration: 0.6, ease: m3Easings.emphasizedDecelerate }
      : { duration: 0.25, ease: m3Easings.emphasizedAccelerate };
  }
  // Default speed
  return isActive
    ? { delay: 0.1, duration: 0.35, ease: m3Easings.emphasizedDecelerate }
    : { duration: 0.15, ease: m3Easings.emphasizedAccelerate };
}

/**
 * M3ContainerTransform component.
 * Implements the Material 3 Container Transform motion pattern using shared element transitions.
 * Use the same layoutId on both source and target containers to morph them smoothly.
 */
export const M3ContainerTransform = React.forwardRef<HTMLDivElement, M3ContainerTransformProps>(
  (
    {
      layoutId,
      speed = "default",
      isExpanded = false,
      children,
      transition,
      style,
      ...props
    }: M3ContainerTransformProps,
    ref,
  ) => {
    const reduced = useM3ReducedMotion();
    // Select the M3 spatial spring configuration based on speed
    const springConfig = m3Springs[speed].spatial;

    const contextValue = React.useMemo(() => ({ isExpanded, speed }), [isExpanded, speed]);

    return (
      <M3ContainerTransformContext.Provider value={contextValue}>
        <motion.div
          ref={ref}
          layoutId={reduced ? undefined : layoutId}
          layout={!reduced}
          transition={
            reduced ? { type: "tween", duration: 0, delay: 0 } : transition || springConfig
          }
          style={{
            position: "relative",
            willChange: "transform, border-radius",
            overflow: "hidden",
            ...style,
          }}
          {...props}
        >
          {children}
        </motion.div>
      </M3ContainerTransformContext.Provider>
    );
  },
);

M3ContainerTransform.displayName = "M3ContainerTransform";

export interface M3ContainerTransformStartProps extends HTMLMotionProps<"div"> {
  /**
   * Overrides the active state. By default, active when isExpanded is false.
   */
  active?: boolean;
}

export interface M3ContainerTransformEndProps extends HTMLMotionProps<"div"> {
  /**
   * Overrides the active state. By default, active when isExpanded is true.
   */
  active?: boolean;
}

/**
 * One cross-fading layer of the container transform. `start` is shown while collapsed, `end` while
 * expanded; the inactive layer is taken out of the flow and stops receiving pointer events, so the
 * content never distorts during the morph.
 */
const ContainerTransformLayer = React.forwardRef<
  HTMLDivElement,
  M3ContainerTransformStartProps & { layer: "start" | "end" }
>(({ layer, active, children, style, transition, layout = "position", ...props }, ref) => {
  const reduced = useM3ReducedMotion();
  const context = React.useContext(M3ContainerTransformContext);
  const isActive = active ?? (context ? context.isExpanded === (layer === "end") : true);
  const speed = context?.speed ?? "default";

  const baseStyle: MotionStyle = {
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    pointerEvents: isActive ? "auto" : "none",
    ...(!isActive && {
      position: "absolute",
      top: 0,
      left: 0,
    }),
    ...style,
  };

  return (
    <motion.div
      ref={ref}
      layout={reduced ? false : layout}
      {...(layer === "end" ? { initial: reduced ? false : { opacity: 0 } } : {})}
      animate={{ opacity: isActive ? 1 : 0 }}
      transition={
        reduced
          ? { type: "tween", duration: 0, delay: 0 }
          : transition || getDefaultTransition(isActive, speed)
      }
      style={baseStyle}
      {...props}
      inert={!isActive || props.inert}
      aria-hidden={!isActive || props["aria-hidden"]}
    >
      {children}
    </motion.div>
  );
});

/**
 * M3ContainerTransformStart component.
 * Represents the starting content (e.g., Card content) inside M3ContainerTransform.
 * Prevents aspect ratio distortion and fades out during the container transform morph.
 */
export const M3ContainerTransformStart = React.forwardRef<
  HTMLDivElement,
  M3ContainerTransformStartProps
>((props, ref) => <ContainerTransformLayer layer="start" ref={ref} {...props} />);

M3ContainerTransformStart.displayName = "M3ContainerTransformStart";

/**
 * M3ContainerTransformEnd component.
 * Represents the target content (e.g., Detail page content) inside M3ContainerTransform.
 * Prevents aspect ratio distortion and fades in during the container transform morph.
 */
export const M3ContainerTransformEnd = React.forwardRef<
  HTMLDivElement,
  M3ContainerTransformEndProps
>((props, ref) => <ContainerTransformLayer layer="end" ref={ref} {...props} />);

M3ContainerTransformEnd.displayName = "M3ContainerTransformEnd";
