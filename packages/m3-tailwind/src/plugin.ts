// SPDX-License-Identifier: Apache-2.0
// Optional JS plugin (`@plugin "@aphrody/m3-tailwind/plugin";`): M3 state layers as utilities.
import plugin from "tailwindcss/plugin";

/** `state-layer` paints the M3 state layer over the element using the current text colour. */
export default plugin(({ addUtilities }) => {
  addUtilities({
    ".state-layer": {
      position: "relative",
      "&::after": {
        content: '""',
        position: "absolute",
        inset: "0",
        "border-radius": "inherit",
        "background-color": "currentColor",
        opacity: "0",
        "pointer-events": "none",
        transition:
          "opacity var(--md-sys-motion-duration-short2, 100ms) var(--md-sys-motion-easing-standard, ease)",
      },
      "&:hover::after": { opacity: "var(--md-sys-state-hover-state-layer-opacity, 0.08)" },
      "&:focus-visible::after": { opacity: "var(--md-sys-state-focus-state-layer-opacity, 0.1)" },
      "&:active::after": { opacity: "var(--md-sys-state-pressed-state-layer-opacity, 0.1)" },
    },
  });
});
