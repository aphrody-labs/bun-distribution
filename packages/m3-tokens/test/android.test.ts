import { describe, expect, test } from "bun:test";
import { toAndroidColorScheme } from "../src/android";

describe("Android Material 3 role mapping", () => {
  test("maps CSS roles to Compose-style names", () => {
    const scheme = toAndroidColorScheme({
      primary: "#6750A4",
      "on-primary": "#FFFFFF",
      "primary-container": "#EADDFF",
      "on-primary-container": "#21005D",
      secondary: "#625B71",
      "on-secondary": "#FFFFFF",
      "secondary-container": "#E8DEF8",
      "on-secondary-container": "#1D192B",
      tertiary: "#7D5260",
      "on-tertiary": "#FFFFFF",
      "tertiary-container": "#FFD8E4",
      "on-tertiary-container": "#31111D",
      error: "#B3261E",
      "on-error": "#FFFFFF",
      "error-container": "#F9DEDC",
      "on-error-container": "#410E0B",
      background: "#FFFBFE",
      "on-background": "#1C1B1F",
      surface: "#FFFBFE",
      "on-surface": "#1C1B1F",
      "surface-variant": "#E7E0EC",
      "on-surface-variant": "#49454F",
      "surface-tint": "#6750A4",
      "inverse-surface": "#313033",
      "inverse-on-surface": "#F4EFF4",
      "inverse-primary": "#D0BCFF",
      outline: "#79747E",
      "outline-variant": "#CAC4D0",
      scrim: "#000000",
    });

    expect(scheme.primary).toBe("#6750A4");
    expect(scheme.onPrimaryContainer).toBe("#21005D");
    expect(scheme.outlineVariant).toBe("#CAC4D0");
  });
});
