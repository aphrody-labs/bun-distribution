// SPDX-License-Identifier: Apache-2.0

export interface ThemeColors {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  surface: string;
  onSurface: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceVariant: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  background: string;
  onBackground: string;
}

export function applyM3Theme(seedColor: string, dark: boolean): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (dark) {
    root.classList.add('dark');
    root.style.setProperty('--md-sys-color-primary', seedColor);
    root.style.setProperty('--md-sys-color-on-primary', '#000000');
    root.style.setProperty('--md-sys-color-primary-container', '#3b2d54');
    root.style.setProperty('--md-sys-color-on-primary-container', '#eaddff');
    root.style.setProperty('--md-sys-color-secondary', '#ccc2dc');
    root.style.setProperty('--md-sys-color-on-secondary', '#332d41');
    root.style.setProperty('--md-sys-color-secondary-container', '#4a4458');
    root.style.setProperty('--md-sys-color-on-secondary-container', '#e8def8');
    root.style.setProperty('--md-sys-color-tertiary', '#efb8c8');
    root.style.setProperty('--md-sys-color-on-tertiary', '#492532');
    root.style.setProperty('--md-sys-color-tertiary-container', '#633b48');
    root.style.setProperty('--md-sys-color-on-tertiary-container', '#ffd8e4');
    root.style.setProperty('--md-sys-color-surface', '#141218');
    root.style.setProperty('--md-sys-color-on-surface', '#e6e0e9');
    root.style.setProperty('--md-sys-color-surface-container-low', '#1d1b20');
    root.style.setProperty('--md-sys-color-surface-container', '#211f26');
    root.style.setProperty('--md-sys-color-surface-container-high', '#2b2930');
    root.style.setProperty('--md-sys-color-surface-container-highest', '#36343b');
    root.style.setProperty('--md-sys-color-surface-variant', '#49454f');
    root.style.setProperty('--md-sys-color-on-surface-variant', '#cac4d0');
    root.style.setProperty('--md-sys-color-outline', '#938f99');
    root.style.setProperty('--md-sys-color-outline-variant', '#49454f');
    root.style.setProperty('--md-sys-color-background', '#141218');
    root.style.setProperty('--md-sys-color-on-background', '#e6e0e9');
  } else {
    root.classList.remove('dark');
    root.style.setProperty('--md-sys-color-primary', seedColor);
    root.style.setProperty('--md-sys-color-on-primary', '#ffffff');
    root.style.setProperty('--md-sys-color-primary-container', '#eaddff');
    root.style.setProperty('--md-sys-color-on-primary-container', '#21005d');
    root.style.setProperty('--md-sys-color-secondary', '#625b71');
    root.style.setProperty('--md-sys-color-on-secondary', '#ffffff');
    root.style.setProperty('--md-sys-color-secondary-container', '#e8def8');
    root.style.setProperty('--md-sys-color-on-secondary-container', '#1d192b');
    root.style.setProperty('--md-sys-color-tertiary', '#7d5260');
    root.style.setProperty('--md-sys-color-on-tertiary', '#ffffff');
    root.style.setProperty('--md-sys-color-tertiary-container', '#ffd8e4');
    root.style.setProperty('--md-sys-color-on-tertiary-container', '#31111d');
    root.style.setProperty('--md-sys-color-surface', '#fef7ff');
    root.style.setProperty('--md-sys-color-on-surface', '#1d1b20');
    root.style.setProperty('--md-sys-color-surface-container-low', '#f7f2fa');
    root.style.setProperty('--md-sys-color-surface-container', '#f3edf7');
    root.style.setProperty('--md-sys-color-surface-container-high', '#ece6f0');
    root.style.setProperty('--md-sys-color-surface-container-highest', '#e6e0e9');
    root.style.setProperty('--md-sys-color-surface-variant', '#e7e0ec');
    root.style.setProperty('--md-sys-color-on-surface-variant', '#49454f');
    root.style.setProperty('--md-sys-color-outline', '#79747e');
    root.style.setProperty('--md-sys-color-outline-variant', '#cac4d0');
    root.style.setProperty('--md-sys-color-background', '#fef7ff');
    root.style.setProperty('--md-sys-color-on-background', '#1d1b20');
  }
}
