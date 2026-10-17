// SPDX-License-Identifier: Apache-2.0
//! Core type definitions for design compiler engine.

export type OutputKind = "deck" | "prototype" | "dashboard" | "mobile" | "editorial" | "other";

export interface DesignBrief {
  /** The type of artifact we are generating */
  outputKind: OutputKind;
  /** Target device classes, e.g. ["responsive-web", "ios", "desktop"] */
  platforms: string[];
  /** Target demographic or user base */
  audience: string;
  /** Design tone keys, e.g. ["editorial", "minimal", "utility"] */
  tones: string[];
  /** Numeric color seed (HEX string, e.g. "#6750A4") */
  seedColor: string;
  /** Approximate scale of output, e.g. "5 slides" or "3 screens" */
  scale: string;
  /** Hard structural constraints */
  constraints: string;
  /** Raw natural language user brief */
  rawBrief: string;
  /** Layout organization style */
  layoutType: "feed" | "list-detail" | "supporting-pane" | "scaffold";
  /** Visual spacing and density levels */
  density: "default" | "high" | "low";
  /** Presence of interactive thinking animation indicator */
  hasThinkingIndicator: boolean;
  /** Presence of real-time careted streaming responses */
  hasStreaming: boolean;
  /** Presence of central action-router delegation and dynamic handler maps */
  hasActionRouter: boolean;
  /** Optional custom design system ID override */
  designSystemId?: string;
}

export interface TonalPalette {
  /** Palette name: primary, secondary, tertiary, error, neutral, neutral-variant */
  name: string;
  /** HCT palette colors indexed by tone, including all system-role reference tones. */
  tones: { [tone: number]: string };
}

export interface M3Theme {
  seed: string;
  palettes: {
    primary: TonalPalette;
    secondary: TonalPalette;
    tertiary: TonalPalette;
    neutral: TonalPalette;
    neutralVariant: TonalPalette;
    error: TonalPalette;
  };
  cssCustomProperties: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GenerationResult {
  brief: DesignBrief;
  theme: M3Theme;
  files: GeneratedFile[];
  critique: {
    scores: {
      philosophy: number;
      hierarchy: number;
      detail: number;
      functionalParity: number;
      innovation: number;
    };
    rationale: string;
    issues?: SpecIssue[];
  };
}

export interface SpecIssue {
  level: "error" | "warning" | (string & {});
  line: number;
  rule: string;
  message: string;
}

export interface SpecValidation {
  score: number;
  issues: SpecIssue[];
}

/** Checks generated source against M3 specification rules. */
export type SpecValidator = (code: string) => SpecValidation;

/** Returns the `tokens.css` body of a design system, or `undefined` when unknown. */
export type DesignSystemLoader = (id: string) => string | undefined;
