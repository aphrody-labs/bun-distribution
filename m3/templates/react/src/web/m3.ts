// Material 3 web components (@aphrody/material-web, built with Lit) wrapped for React with @lit/react.
// Importing a component module registers its custom element, so the bundle carries only what is listed
// here. To add one, import `@aphrody/material-web/<group>/<component>.js` and wrap it the same way.
import { MdFilledButton } from "@aphrody/material-web/button/filled-button.js";
import { MdTextButton } from "@aphrody/material-web/button/text-button.js";
import { MdLinearProgress } from "@aphrody/material-web/progress/linear-progress.js";
import { MdOutlinedTextField } from "@aphrody/material-web/textfield/outlined-text-field.js";
import { createComponent } from "@lit/react";
import * as React from "react";

export const FilledButton = createComponent({
  react: React,
  tagName: "md-filled-button",
  elementClass: MdFilledButton,
});

export const TextButton = createComponent({
  react: React,
  tagName: "md-text-button",
  elementClass: MdTextButton,
});

export const LinearProgress = createComponent({
  react: React,
  tagName: "md-linear-progress",
  elementClass: MdLinearProgress,
});

export const OutlinedTextField = createComponent({
  react: React,
  tagName: "md-outlined-text-field",
  elementClass: MdOutlinedTextField,
  events: { onInput: "input" },
});

export type TextFieldElement = MdOutlinedTextField;
