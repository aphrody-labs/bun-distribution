// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { normalizeSeed, rustVariant, schemeRoles } from "@aphrody/m3-theme";
import {
  useM3Theme,
  type SchemeVariant,
  type ThemeMode,
} from "@aphrody/m3-theme/react";
import { Button, Input } from "@aphrody/m3-primitives";
import { Card, Code, Page, Section, Swatch } from "../ui.tsx";
import type { PageProps } from "./index.ts";

// Variants rendered by aphrody_m3_tokens::scheme.
const VARIANTS: SchemeVariant[] = [
  "tonalSpot",
  "fidelity",
  "expressive",
  "vibrant",
  "neutral",
  "monochrome",
];
const PAIRS = [
  ["primary", "on-primary"],
  ["primary-container", "on-primary-container"],
  ["secondary", "on-secondary"],
  ["tertiary", "on-tertiary"],
  ["surface", "on-surface"],
  ["surface-container", "on-surface"],
  ["error", "on-error"],
  ["error-container", "on-error-container"],
] as const;

export default function Theme({ adaptive }: PageProps) {
  const theme = useM3Theme();
  const [scheme, setScheme] = useState<
    { roles: Record<string, string> } | { error: string }
  >();
  const { sheet, seedColor, variant, contrastLevel, resolvedTheme } = theme;
  useEffect(() => {
    if (!sheet) return;
    let current = true;
    Promise.resolve()
      .then(() =>
        sheet({
          sheet: "scheme",
          seed: normalizeSeed(seedColor),
          variant: rustVariant(variant),
          contrast: contrastLevel,
          dark: resolvedTheme === "dark",
        }),
      )
      .then((css) => current && setScheme({ roles: schemeRoles(css) }))
      .catch(
        (error: unknown) => current && setScheme({ error: String(error) }),
      );
    return () => {
      current = false;
    };
  }, [sheet, seedColor, variant, contrastLevel, resolvedTheme]);
  const roles = scheme && "roles" in scheme ? scheme.roles : {};
  const failure =
    theme.schemeError?.message ??
    (scheme && "error" in scheme ? scheme.error : undefined);
  return (
    <Page
      title="Theme"
      summary="Derive a complete Material 3 colour scheme from one seed with the Rust renderer (aphrody-m3-tokens). Changes apply to this whole section, including React components and Lit shadow DOM."
      packages={["@aphrody/m3-theme", "@aphrody/m3-tokens"]}
      panes={adaptive.panes}
      aside={
        <Card>
          <h3 className="text-title-medium">Current scheme</h3>
          <Code>
            {JSON.stringify(
              {
                seed: theme.seedColor,
                mode: theme.themeMode,
                resolved: theme.resolvedTheme,
                variant: theme.variant,
                contrast: theme.contrastLevel,
              },
              null,
              2,
            )}
          </Code>
        </Card>
      }
    >
      {!sheet && (
        <p role="alert" className="text-body-large text-error">
          This host has no Rust scheme sheet source; only the compiled theme is
          shown.
        </p>
      )}
      {failure && (
        <p role="alert" className="text-body-large text-error">
          {failure}
        </p>
      )}
      <Section title="Customise the live theme">
        <Card className="grid gap-4 medium:grid-cols-2">
          <div className="flex flex-col gap-2 text-label-large">
            Seed colour
            <Input
              type="color"
              value={theme.seedColor}
              onChange={(event) => theme.setSeedColor(event.target.value)}
              aria-label="Seed colour"
            />
          </div>
          <label className="flex flex-col gap-2 text-label-large">
            Scheme variant
            <select
              className="h-12 rounded-small border border-outline bg-surface px-3 text-body-large"
              value={theme.variant}
              onChange={(event) =>
                theme.setVariant(event.target.value as SchemeVariant)
              }
            >
              {VARIANTS.map((schemeVariant) => (
                <option key={schemeVariant}>{schemeVariant}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-label-large">
            Colour mode
            <select
              className="h-12 rounded-small border border-outline bg-surface px-3 text-body-large"
              value={theme.themeMode}
              onChange={(event) =>
                theme.setThemeMode(event.target.value as ThemeMode)
              }
            >
              {(["light", "dark", "system"] as const).map((mode) => (
                <option key={mode}>{mode}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-label-large">
            Contrast: {theme.contrastLevel}
            <input
              type="range"
              min={-1}
              max={1}
              step={0.1}
              value={theme.contrastLevel}
              onChange={(event) =>
                theme.setContrastLevel(Number(event.target.value))
              }
            />
            <span className="text-body-small text-on-surface-variant">
              0 is standard; 1 requests maximum contrast.
            </span>
          </label>
          <Button
            variant="outlined"
            onClick={() => {
              theme.setSeedColor("#8c6c88");
              theme.setVariant("tonalSpot");
              theme.setThemeMode("system");
              theme.setContrastLevel(0);
            }}
          >
            Reset theme
          </Button>
        </Card>
      </Section>
      <Section
        title="Roles and their text colours"
        description={`${Object.keys(roles).length} roles rendered by Rust for ${theme.resolvedTheme} mode.`}
      >
        <div className="grid grid-cols-2 gap-3 expanded:grid-cols-4">
          {PAIRS.map(([role, on]) => (
            <Swatch
              key={role}
              name={role}
              value={
                roles[`--md-sys-color-${role}`] ?? `var(--md-sys-color-${role})`
              }
              on={roles[`--md-sys-color-${on}`] ?? `var(--md-sys-color-${on})`}
            />
          ))}
        </div>
      </Section>
      <Section title="Live scheme output">
        <Code>
          {Object.entries(roles)
            .map(([name, value]) => `${name}: ${value};`)
            .join("\n")}
        </Code>
      </Section>
    </Page>
  );
}
