/**
 * Material 3 role names shared with Android Compose.
 *
 * The values are semantic aliases, not a second palette. They let adapters
 * serialize the same scheme using Android-style camelCase names while CSS
 * and Material Web continue to use the kebab-case token form.
 */
export const ANDROID_COLOR_ROLES = {
  background: "background",
  onBackground: "on-background",
  surface: "surface",
  onSurface: "on-surface",
  surfaceVariant: "surface-variant",
  onSurfaceVariant: "on-surface-variant",
  surfaceDim: "surface-dim",
  surfaceBright: "surface-bright",
  surfaceContainerLowest: "surface-container-lowest",
  surfaceContainerLow: "surface-container-low",
  surfaceContainer: "surface-container",
  surfaceContainerHigh: "surface-container-high",
  surfaceContainerHighest: "surface-container-highest",
  surfaceTint: "surface-tint",
  inverseSurface: "inverse-surface",
  inverseOnSurface: "inverse-on-surface",
  primary: "primary",
  onPrimary: "on-primary",
  primaryContainer: "primary-container",
  onPrimaryContainer: "on-primary-container",
  primaryFixed: "primary-fixed",
  primaryFixedDim: "primary-fixed-dim",
  onPrimaryFixed: "on-primary-fixed",
  onPrimaryFixedVariant: "on-primary-fixed-variant",
  inversePrimary: "inverse-primary",
  secondary: "secondary",
  onSecondary: "on-secondary",
  secondaryContainer: "secondary-container",
  onSecondaryContainer: "on-secondary-container",
  secondaryFixed: "secondary-fixed",
  secondaryFixedDim: "secondary-fixed-dim",
  onSecondaryFixed: "on-secondary-fixed",
  onSecondaryFixedVariant: "on-secondary-fixed-variant",
  tertiary: "tertiary",
  onTertiary: "on-tertiary",
  tertiaryContainer: "tertiary-container",
  onTertiaryContainer: "on-tertiary-container",
  tertiaryFixed: "tertiary-fixed",
  tertiaryFixedDim: "tertiary-fixed-dim",
  onTertiaryFixed: "on-tertiary-fixed",
  onTertiaryFixedVariant: "on-tertiary-fixed-variant",
  error: "error",
  onError: "on-error",
  errorContainer: "error-container",
  onErrorContainer: "on-error-container",
  outline: "outline",
  outlineVariant: "outline-variant",
  shadow: "shadow",
  scrim: "scrim",
} as const;

export type AndroidColorRole = keyof typeof ANDROID_COLOR_ROLES;
export type AndroidColorScheme = Record<AndroidColorRole, string>;

/** Convert one CSS role map to the Android Compose naming convention. */
export function toAndroidColorScheme(
  roles: Record<string, string>,
): AndroidColorScheme {
  const result = {} as AndroidColorScheme;
  for (const [androidName, cssName] of Object.entries(ANDROID_COLOR_ROLES)) {
    const value = roles[cssName] ?? roles[`--md-sys-color-${cssName}`];
    if (!value)
      throw new TypeError(`Missing Material 3 color role: ${cssName}`);
    result[androidName as AndroidColorRole] = value;
  }
  return result;
}
