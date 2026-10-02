// SPDX-License-Identifier: Apache-2.0
/**
 * Shenron Studio Theme Tokens (Dragon Ball M3 Palette)
 * Injects Dragon Ball canonical colors into Material Design 3 dynamic roles.
 */
export const SHENRON_THEME_CSS = `
/* Shenron Dark Mode Theme (Default / Space & Namek Night) */
:root[data-theme="shenron"],
.dark[data-theme="shenron"],
.shenron-mode {
  --md-sys-color-background: #0a0a0a;
  --md-sys-color-on-background: #efe9d8;
  --md-sys-color-surface: #0f1012;
  --md-sys-color-surface-dim: #0a0a0a;
  --md-sys-color-surface-bright: #252830;
  --md-sys-color-surface-container-lowest: #050505;
  --md-sys-color-surface-container-low: #141410;
  --md-sys-color-surface-container: #1a1b20;
  --md-sys-color-surface-container-high: #24262c;
  --md-sys-color-surface-container-highest: #2e3038;
  --md-sys-color-on-surface: #efe9d8;
  --md-sys-color-surface-variant: #2a2a26;
  --md-sys-color-on-surface-variant: #cdcdcd;

  /* Primary: Dragon Ball Gi Orange / Amber Aura */
  --md-sys-color-primary: #ff7700;
  --md-sys-color-on-primary: #1e0900;
  --md-sys-color-primary-container: #471800;
  --md-sys-color-on-primary-container: #ffdbcb;

  /* Secondary: Divine Kamé Blue / Royal Saiyan */
  --md-sys-color-secondary: #3b82f6;
  --md-sys-color-on-secondary: #001e4a;
  --md-sys-color-secondary-container: #1e244d;
  --md-sys-color-on-secondary-container: #d9e2ff;

  /* Tertiary: Sacred Dragon Shenron Emerald Green */
  --md-sys-color-tertiary: #10b981;
  --md-sys-color-on-tertiary: #00281b;
  --md-sys-color-tertiary-container: #004d36;
  --md-sys-color-on-tertiary-container: #82f8cb;

  /* Accent Gold / Dragon Ball Stars */
  --dbz-star-gold: #fefd03;
  --dbz-majin-crimson: #de0b36;
  --dbz-ki-cyan: #22d3ee;
}
`;
