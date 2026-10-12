import { describe, expect, test } from "bun:test";
import { ANDROID_COLOR_ROLES, toAndroidColorScheme } from "../src/android";

describe("Android Material 3 role mapping", () => {
  test("maps CSS roles to Compose-style names", () => {
    const roles = Object.fromEntries(
      Object.values(ANDROID_COLOR_ROLES).map((role) => [role, `#${"123456"}`]),
    );
    roles.primary = "#6750A4";
    roles["on-primary-container"] = "#21005D";
    roles["outline-variant"] = "#CAC4D0";
    const scheme = toAndroidColorScheme(roles);

    expect(scheme.primary).toBe("#6750A4");
    expect(scheme.onPrimaryContainer).toBe("#21005D");
    expect(scheme.outlineVariant).toBe("#CAC4D0");
    expect(Object.keys(scheme)).toHaveLength(49);
  });
});
