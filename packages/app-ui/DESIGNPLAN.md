<!-- SPDX-License-Identifier: Apache-2.0 -->

# Canonical Aphrody surfaces

Owner request, 2026-10-09: serve the real app-ui and M3 packages across sites,
application, documentation, templates and showcase. The existing ShellLayout
and navigation remain the single application scaffold. Browser home renders
immediately; the native desktop retains its explorer default.

Use the genuine identity package's portrait and animated atlas. Derive both
colour schemes and all semantic surfaces from PET_COLORS.seed through the Rust
owner (aphrody-m3-tokens ThemeExport in src/generated/); preserve accessible contrast and reduced motion.
Public content reads the native site catalogs; errors have a bounded retry state.
Showcase routes mount existing package demonstrations inside the same shell,
with a local theme target so experimental colours cannot change app preferences.

Validate generated colour parity and contrast, catalog rejection/abort behavior,
public content rendering, TypeScript, lint, formatting and the real UI build.
Browser verification covers home, documentation, templates, showcase components
and compact navigation against the native HTTP owner. Host capabilities keep
their existing authenticated boundary.
