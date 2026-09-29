<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody UI accessibility

The M3 `LOW_VISION` profile from `aphrody-m3-tokens` is the default desktop
accessibility contract:

- 18 px minimum type and 120% line height;
- high contrast, static focus and visible keyboard navigation;
- screen-reader semantics at the desktop boundary;
- reduced motion and platform text scaling.

WezTerm and Narrator are host tools, not UI components or token authorities.
On Linux, accessibility uses the host AT-SPI stack.
