/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
import { TypeScaleRole } from "./type-scale.js";
/**
 * `<md-type>` renders slotted text in a Material 3 type-scale role using Google
 * Sans Flex, and exposes every variable axis as an attribute for maximum
 * flexibility. Set `scale` to pick a role; override any single axis
 * (`wght`/`opsz`/`wdth`/`grad`/`slnt`/`rond`) without disturbing the others.
 * With `animated`, axis changes tween smoothly (font-variation-settings is an
 * animatable CSS property), enabling expressive typographic motion.
 *
 * The host is `display: contents` by default so it does not disturb layout;
 * set `block` to render as a block-level element.
 */
export declare class MdType extends LitElement {
    /** The M3 type-scale role to apply. */
    scale: TypeScaleRole;
    /** Weight axis override (`wght`, 100–900). */
    wght?: number;
    /** Optical-size axis override (`opsz`, 9–144). */
    opsz?: number;
    /** Width axis override (`wdth`, 75–125). */
    wdth?: number;
    /** Grade axis override (`GRAD`, -200–150). */
    grad?: number;
    /** Slant axis override (`slnt`, -10–0). */
    slnt?: number;
    /** Roundness axis override (`ROND`, 0–100). */
    rond?: number;
    /**
     * Render in Google Sans Code (monospace face) instead of Google Sans Flex —
     * for code, terminals, and tabular data. Uses the `MONO`/`wght` axes.
     */
    code: boolean;
    /** Google Sans Code `MONO` axis (0 = proportional, 1 = monospace). */
    mono?: number;
    /** Tween axis changes (font-variation-settings transition). */
    animated: boolean;
    /** Render as a block element instead of `display: contents`. */
    block: boolean;
    /** Resolve the effective axis settings: scale defaults + attribute overrides. */
    private resolveAxes;
    protected render(): import("lit-html").TemplateResult<1>;
}
