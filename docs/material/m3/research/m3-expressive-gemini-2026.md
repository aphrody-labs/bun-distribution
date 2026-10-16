# Material 3 Expressive and Gemini web design reference (2026-10-02)

Every value carries its source. UNVERIFIED means not confirmed from a primary source.
Fetched 2026-10-02 with curl and `aphrody-web`.

Source keys:
- CMP = `https://android.googlesource.com/platform/frameworks/support/+/refs/heads/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/<File>.kt` (base64 `?format=TEXT`)
- MW = `https://raw.githubusercontent.com/material-components/material-web/v2.5.0/tokens/versions/latest/sass/<file>.scss` (v2.5.0 published 2026-07-15, design system 34.0.21)
- MCU = `https://github.com/material-foundation/material-color-utilities` (typescript/, main at 5b3618b, 2026-08-21)
- GEM = `https://gemini.google.com/app` (inline CSS, 2622 custom properties, HTTP 200)

m3.material.io is an Angular SPA. `aphrody-web fetch` threw JS errors and returned no content, so no
m3.material.io page value is cited. design.google fetched fine but holds only editorial content, no tokens.

## 1. Motion springs (Compose scheme tokens vs web tokens)

| Token | Expressive damping / stiffness (CMP ExpressiveMotionTokens) | Standard (CMP StandardMotionTokens) | MW web (`_md-sys-motion`) |
|---|---|---|---|
| default spatial | 0.8 / 380 | 0.9 / 700 | 0.9 / 700 |
| fast spatial | 0.6 / 800 | 0.9 / 1400 | 0.9 / 1400 |
| slow spatial | 0.8 / 200 | 0.9 / 300 | 0.9 / 300 |
| default effects | 1.0 / 1600 | 1.0 / 1600 | 1 / 1600 |
| fast effects | 1.0 / 3800 | 1.0 / 3800 | 1 / 3800 |
| slow effects | 1.0 / 800 | 1.0 / 800 | 1 / 800 |

The material-web v2.5.0 token set carries one spring set only, and it equals the Compose Standard scheme.
MotionScheme.kt (`standard()` / `expressive()`) reads these constants. The MW set is not the Expressive set.

Easing, MW and GEM identical: emphasized `cubic-bezier(0.2,0,0,1)`, emphasized-decelerate `(0.05,0.7,0.1,1)`,
emphasized-accelerate `(0.3,0,0.8,0.15)`, standard-decelerate `(0,0,0,1)`, standard-accelerate `(0.3,0,1,1)`,
legacy `(0.4,0,0.2,1)`. Durations: short1-4 = 50/100/150/200ms, medium1-4 = 250/300/350/400ms, long1-4 = 450/500/550/600ms,
extra-long1-4 = 700/800/900/1000ms (MW, GEM `--gem-sys-motion--duration-*`).

## 2. Shape (CMP ShapeTokens.kt, MW `_md-sys-shape`, GEM `--gem-sys-shape--*`)

none 0, extra-small 4, small 8, medium 12, large 16, large-increased 20, extra-large 28, extra-large-increased 32,
extra-extra-large 48, full = circle (9999px in GEM). GEM adds `corner-large-max` 24px, `corner-extra-large-max` 40px,
and `corner-extra-extra-large-increased` 48px in one theme and 56px in another (two values served in the same CSS).

## 3. Typography (CMP TypeScaleTokens.kt; size / line height in sp; MW tracking in rem)

| Role | Size / LH | Weight | Tracking (MW web) | Tracking (CMP) |
|---|---|---|---|---|
| display-large | 57/64 | 400 | -0.015625rem (-0.25px) | -0.2 |
| display-medium / small | 45/52, 36/44 | 400 | 0 | 0 |
| headline-large / medium / small | 32/40, 28/36, 24/32 | 400 | 0 | 0 |
| title-large | 22/28 | 400 | 0 | 0 |
| title-medium | 16/24 | 500 | 0.009375rem (0.15px) | 0.2 |
| title-small | 14/20 | 500 | 0.1px | 0.1 |
| body-large / medium / small | 16/24, 14/20, 12/16 | 400 | 0.5, 0.25 (0.015625rem), 0.4px | 0.5, 0.2, 0.4 |
| label-large / medium / small | 14/20, 12/16, 11/16 | 500 | 0.1 (0.00625rem), 0.5, 0.5px | 0.1, 0.5, 0.5 |

Expressive "emphasized" styles (CMP): display, headline and title-large go to weight 500. Title-medium, title-small
and all label sizes go to 700. Body styles go to 500. Sizes, line heights and tracking are unchanged except
body-large (0.15) and body-medium (0.25). Web tracking is the MW value, so the repo's 0.25/0.15 match web
and CMP's rounded values are a platform variance, not a repo bug.

## 4. Color

- Expressive variant: `SchemeExpressive` extends DynamicScheme with `Variant.EXPRESSIVE`, "intentionally detached
  from the source color" (MCU typescript/scheme/scheme_expressive.ts). Its palette hue and chroma rules live in the
  spec-version files (dynamiccolor/*, not transcribed here, UNVERIFIED per value).
- Baseline roles (CMP ColorLightTokens/ColorDarkTokens + PaletteTokens): light surface = Neutral98 (254,247,255) = #FEF7FF,
  dark background and surface = Neutral6 (20,18,24) = #141218, dark surface-container = Neutral12 (33,31,38) = #211F26,
  dark primary = Primary80, light primary = Primary40, on-surface light Neutral10, dark Neutral90.
  New container roles: surface-dim, surface-bright, surface-container-lowest/low/container/high/highest, plus
  primary/secondary/tertiary fixed and fixed-dim.

## 5. Gemini web (GEM, observed live; the repo cites the design.google article for brand colors)

Fonts: `font-family: Google Sans Flex, Google Sans, Helvetica Neue, sans-serif` (70 uses) and
`Google Sans Flex, Google Sans, Roboto, Arial, sans-serif`. Also `Luminous Symbols` and `Google Symbols` icon fonts.
Weights are variable: display-large 280 or 400, headline-large 350 or 400. ROND axis is referenced via `--*-font-rond`.
Display-large size 3.5625rem / 2.8125rem / 2.625rem. Body-large 1rem or 1.0625rem, LH 1.5, 1.625 or 1.875rem.

Color, light / dark (`--gem-sys-color--*`):
primary #0b57d0 / #a8c7fa; primary-container #d3e3fd / #1f3760; secondary #00639b / #7fcfff;
secondary-container #c2e7ff / #004a77; tertiary #146c2e / #6dd58c; error #b3261e / #f2b8b5;
surface #fff / #131314; surface-dim #d3dbe5 / #131314; surface-container #f0f4f9 / #1e1f20;
surface-container-low #f8fafd / #1b1b1b; -high #e9eef6 / #282a2c; -highest #dde3ea / #333537;
on-surface #1f1f1f / #e3e3e3; on-surface-variant #444746 / #c4c7c5; outline #747775 / #8e918f.
Brand: blue #3186ff, red #ff4641, yellow #fc0, green #0ebc5f. Transition stops #346bf1, #4fa0ff, #ff6b2b,
#d8627e, #a975aa, #fa506b, #00a5b7. Title gradient (bard) #4285f4, #9b72cb, #d96570; v2 #3983ff, #3e6af0, #579fff.
Mic gradient #ffaee4, #ad72ff, #c597ff. Outline gradient light #b7a9e5, #c597ff, #4c8df6; dark #ffa3f4, #fdf8ff, #7cacf8.
Side nav: `--bard-color-sidenav-background-desktop` = surface-container (light #e9eef6 in one theme),
scrim rgba(19,19,20,0.4). Zero-state chip bg #d3e3fd / #3b4456, text #0b57d0 / #aec6f6.
Spacing: xs 4, s 8, m 12, l 16, xl 20, xxl 24, xxxl 28px.

Prompt bar (`input-area-container`): grid `upload-icon | input-area | icons`, gap 8px, bg surface,
1px solid outline-variant, radius `corner-extra-large-increased` (32px). Variants: `corner-full`,
`corner-extra-extra-large-increased`, 40px (initial ssr), and `24px 24px 0 0` (docked bottom).
Shadow `0 0 16px 0 on-surface/.16, 0 0 2px 0 on-surface/.1`. Sampled `border-radius` totals: 50% x10, 6px x3, 16px x3.

## 6. Diffs against the repo (current -> spec)

| # | Location | Current | Spec |
|---|---|---|---|
| 1 | crates/ui/m3-tokens/src/motion.rs:196-207 | Expressive fast/default/slow spatial = 0.9/1400, 0.9/700, 0.9/300 (comments "expressive") | Expressive = 0.6/800, 0.8/380, 0.8/200 (CMP ExpressiveMotionTokens). 0.9/700 etc. are the Standard set |
| 2 | motion.rs:240-245 | Standard spatial forced to damping 1.0 with expressive stiffness | Standard = 0.9 with stiffness 1400/700/300 (CMP StandardMotionTokens) |
| 3 | motion.rs:178-181 | `MotionScheme::Expressive` default and comment "(M3 default)" | MW web v2.5.0 ships only the 0.9 set. Choose the scheme per target, document that web tokens equal Standard |
| 4 | motion.rs:367-369 | expressive web cubic-bezier fits (0.38,1.21,...) derived from 0.9/700 base | Re-derive after fixing #1 (UNVERIFIED how they were fitted) |
| 5 | crates/ui/m3-tokens/src/gemini_brand.rs:148 | BRAND_CORNER_PROMPT_BAR_PX = 28 | GEM prompt bar: 32px (`extra-large-increased`), 40px initial, 24px 24px 0 0 docked |
| 6 | gemini_brand.rs:151 | MESSAGE corner 24 | UNVERIFIED in GEM (no message-bubble selector sampled; `large-max` is 24px) |
| 7 | gemini_brand.rs:154 | CHIP corner 18 | No 18px token in GEM or M3. Use `corner-large` 16px or `full` |
| 8 | gemini_brand.rs:50-66 | Blue #4285F4, purple #9168C0, pink #EC4899, yellow #FAE366, green #BFF28D | GEM: brand-blue #3186ff, green #0ebc5f, yellow #fc0, red #ff4641; gradients #4285f4/#9b72cb/#d96570. Repo values come from the article, not served CSS |
| 9 | gemini_brand.rs:86 / test line 362 | FOUR_COLOR_DOTS #4285F4 #EA4335 #FBBC04 #34A853 | GEM brand tokens above differ (legacy Google palette). Choose per surface |
| 10 | crates/ui/m3-tokens/src/shape.rs | has 0..48 and full 9999 | Missing GEM-only `large-max` 24, `extra-large-max` 40, `extra-extra-large-increased` 48/56. Optional, Gemini-only |
| 11 | crates/ui/m3-tokens/src/typography.rs (16 styles, lines 35-172) | No emphasized variants | CMP defines 15 emphasized styles (section 3). Missing |
| 12 | typography.rs / google_sans_flex.rs | Static weights only | GEM uses variable weights 280/350 for display and headline and a ROND axis |
| 13 | packages/m3-theme/tokens.css | Tonal-spot seed #6750a4, no expressive variant | Add `SchemeExpressive`. `scheme.rs:10` states only some variants exist, check Expressive is among them (not verified) |

No diffs found for: easing curves, duration tokens (motion.rs:30-64, 115-127), shape dp values (shape.rs:43-72),
type size/line-height/weight base scale (typography.rs:35-172), tracking vs web tokens.
