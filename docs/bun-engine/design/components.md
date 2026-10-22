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

Result: 25 pairs, 0 failing AA (body text 5.9:1 to 17.8:1, soft text 9.4:1 to 10.8:1, field border 3.82:1,
focus ring 12.1:1 on surfaces). The hero text sits on a scrim over blurred cover art: with the text hidden, the
lightest background pixel behind it gave at least 6.9:1 against the soft text role for each of the five showcase covers.

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

## Built in phase 1 (console-grade home)

Own wording, M3 role tokens, Roboto Flex (OFL, `packages/m3-fonts`), Lucide icons (ISC, inline SVG in
`web/app/icons.ts`), our own pad glyphs (`web/app/glyphs.ts`), art only from our homebrew captures.
Every duration goes through `--dur`, which `prefers-reduced-motion` and the Motion setting set to 0;
interactions animate `transform` and `opacity` only.

```
Top bar (#top)        Library, Systems, Search, Settings tabs (icon + text), status pills, profile and power buttons
                      (aria-label, no icon-only control without a name); aria-current on the active tab
Hero (.hero)          last played game of the profile: blurred cover scrim, title, "Last played ... · N plays",
                      one primary Play, a ghost Details; states: loading skeleton, nothing played yet, empty library,
                      scanning
Shelf (.shelf)        horizontal, scroll-snap, the focused tile is centred; Recent tiles (cover, title, system and age),
                      then system tiles; padded so the 3 px ring is never clipped
Footer hints          glyphs of the connected pad (Gamepad API id: Xbox letters, PlayStation-style shapes, Nintendo letters,
                      generic letters), key caps without a pad
Quick menu            F1, pad Guide/Home or Select + R3 while a game plays: Resume, Save state, Load state, Screenshot,
                      Volume (slider), Stop game (asks first); verified pause state, results of the actions shown
                      in an aria-live line; focus returns to the game frame (or to the opener outside a game)
Confirm dialog        Cancel is focused first (Stop game, Exit to desktop, Restart frontend)
Power menu            Exit to desktop, Restart frontend, Close; each asks to confirm
Search                text field plus a pad-first on-screen keyboard (X deletes, Y adds a space), real keyboard types
                      into the field from anywhere; result rows reuse the game row; states: idle, searching, results,
                      none, error
Settings              Preferences (performance counter, motion: real shell.db keys), Session, Library, Cores and BIOS,
                      Systems and routes, About: all read from the host when the page opens
Profiles              avatar button, "Who is playing?" overlay, add a profile with the on-screen keyboard
States                loading skeletons, error card with Try again, offline banner (the service does not answer)
```

Measured on the VPS in headless Chrome (software rendering, 1280 x 720; `screens/ui-flow.ts`): keydown to
`focusin` 0.6 to 7 ms (limit 100 ms), layout shift 0 after load and after navigation, `requestAnimationFrame`
median 16.7 ms and p95 16.8 ms while idle, no control without an accessible name on the home page, and 0 s
transitions under `prefers-reduced-motion: reduce`. Frame pacing while a game plays was not measured.

## Gaps (not built)

- A per-game page with a hero and a related shelf (the game view still has its list and detail pane).
- Media-app tiles, notifications beyond the toast (controller battery, downloads), focus and select sounds.
- A quick menu for games that run in their own window (release emulators, RetroArch outside the page): only the
  in-process `embedded:<core>` player has the host actions.
- Settings panels for display, audio, network and storage: only the state the host really reports is shown.
- Per-profile saves (states are shared; profiles split recents and play history).
- Reference captures for a pixel comparison: only showcase evidence at 1280x720 exists, no pixel diff.

## Built earlier

- Covers: a `<stem>.png|webp|jpg` next to a game file is stored in `games.cover` at scan time and
  served from `/api/games/:id/cover`. System cards show the first cover of their games as a banner,
  game rows a 2.6 x 1.8 rem thumbnail and the detail pane the picture.
- Showcase library of open homebrew per system (`HOMEBREW.md`) and the library to game to
  `embedded:<core>` player to Escape flow, with focus restored to the launching row.

## Reference reviewed, nothing reused

The community Figma file "Nintendo DS Design System V1.3.3" was read for structure only: pages
Screens, Color & Themes, Grid & Background, Date & Time, BIOS Selections, Navigation & Calibration,
Buttons, Keyboard, Symbols, Pictochat, Cartridges, plus Guide pages for colour, typeface and tokens.
Its License page limits use to mock-ups of interfaces for software that runs only on DS operating
system software, and its CC BY 4.0 text excludes commercial adaptation. The Bun Engine library is
neither, so no asset, token value, typeface or layout from that file is copied here.
What carries over is the idea, not the material: 16 selectable theme colours, a gradient title bar,
and one visible focus treatment per screen.
