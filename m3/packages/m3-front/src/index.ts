// SPDX-License-Identifier: Apache-2.0
export { M3ThemeElement, defineM3Theme, type ThemeMode } from "./theme-element.ts";
export { registerM3, registerM3Component, whenDefined, type M3Catalog } from "./register.ts";
export { observeWindowClass, windowClassFor, type WindowClassState } from "./window-class.ts";
export { cssFromSeed, schemeFromSeed, applyDynamicColor } from "@aphrody/m3-tokens/dynamic-color";
