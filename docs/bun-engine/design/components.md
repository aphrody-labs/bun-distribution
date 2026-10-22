<!-- SPDX-License-Identifier: Apache-2.0 -->
# Bun Engine library: design system

The library UI (`packages/bun-engine/web/app`) is a 10-foot, gamepad-first surface that runs as the
whole gamescope session. It follows the Aphrody M3 contract
([`APHRODY-M3-CANONICAL-CONTRACT.md`](../../material/m3/architecture/design/APHRODY-M3-CANONICAL-CONTRACT.md)):
roles come from `--md-sys-color-*`, and the dark values in `frontend.css` are only fallbacks.

`tokens.json` lists the roles with their M3 mapping and the text pairs. Check them with:

```sh
python <path-to-skill>/replica-design/contrast.py docs/bun-engine/design/tokens.json
```

Result: 13 pairs, 0 failing AA (body text 5.9:1 to 17.8:1, field border 3.82:1).

## Principles taken from console UIs

Patterns only: no logo, icon, copy, colour or layout is reproduced from a console.

- Focus is a solid 3 px ring in the `accent` role, never a colour change alone; focus is never
  hidden behind a fixed bar (Microsoft Xbox/TV guidance).
- Few steps to a game: the cursor lands on the least destructive choice (Nintendo CEDEC 2018).
- Short animations; text before unrecognised icons (same talk).
- A game launched in the iframe returns focus to the launcher on exit (`closePlayer`).
- Sources: [Designing for Xbox and TV](https://learn.microsoft.com/pl-pl/windows/apps/design/devices/designing-for-tv),
  [Nintendo at CEDEC 2018](https://nintendowire.com/news/2018/08/22/nintendo-talks-about-the-design-of-the-switchs-os-at-cedec-2018/).

## Components

```
System card (.system)
  grid      auto-fill, min 17rem; min-height 10.5rem; radius 1.1rem
  states    default, focus (ring), dim (no installed route), loading
  tokens    surface, border, text, accent ring
  a11y      data-nav, reachable by D-pad in visual order
  used on   library home

Game row (.game)
  layout    favourite, title, meta; radius 0.6rem
  states    default, focus (ring + meta shown), favourite, running
  a11y      Enter or A launches; Select+Start stops an embedded game

Route chip (.route)
  states    available, off (reason shown), selected
  tokens    success for available, warning for off, never colour alone

Button (.ghost, .primary, toolbar, actions)
  variants  ghost (surface-high + border), primary (text on bg inverted)
  states    default, hover, focus (ring), disabled
  a11y      real <button>; keep visible text, no icon-only controls

Field (.add input, .add select)
  border    border-input role (3.82:1), not the divider token
  states    default, focus (ring), error (danger + text)
  a11y      visible label or placeholder with an accessible name

Player (iframe)
  entry     embedded:<core> route, own port per game
  exit      Escape or Select+Start; focus returns to the launching element
```

## Gaps (not built)

- A "recent" row of large tiles at the top of the library.
- A secondary row for system actions (settings, quit).
- Confirm dialogs for stop and remove, with the safe choice focused first.
- Reference captures for a pixel comparison: none are tracked; capture the library on the VPS
  (sway headless and Chrome kiosk) before comparing.

## Reference reviewed, nothing reused

The community Figma file "Nintendo DS Design System V1.3.3" was read for structure only: pages
Screens, Color & Themes, Grid & Background, Date & Time, BIOS Selections, Navigation & Calibration,
Buttons, Keyboard, Symbols, Pictochat, Cartridges, plus Guide pages for colour, typeface and tokens.
Its License page limits use to mock-ups of interfaces for software that runs only on DS operating
system software, and its CC BY 4.0 text excludes commercial adaptation. The Bun Engine library is
neither, so no asset, token value, typeface or layout from that file is copied here.
What carries over is the idea, not the material: 16 selectable theme colours, a gradient title bar,
and one visible focus treatment per screen.
