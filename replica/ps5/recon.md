<!-- SPDX-License-Identifier: Apache-2.0 -->
# Console home UI patterns (PS5 community mock-up): recon map

Scope: study how a living-room console home is organised so the Bun Engine library
(`packages/bun-engine/web/app`) can adopt the patterns. Clean-room: structure and flows only. No logo,
game art, icon, typeface, copy or colour value is taken; no screenshot is stored in this repository.
PlayStation and the game titles shown belong to their owners.

## Owner decision (2026-10-22)

Build our own console-grade UI and our own gamescope session at the same feature set and the same
level of finish as a current console home, with no copied material: our name, our wording, our
colours (M3 role tokens), our open typeface, our icons (open set), art from open homebrew captures only.
"Premium" is defined by measurable rules, not by imitation: 60 fps interaction, focus moves in at most
100 ms, every state designed (empty, loading, error, offline), AA contrast everywhere
(`docs/bun-engine/design/tokens.json`), reduced-motion honoured, full D-pad and keyboard reach, and
one visible focus treatment. Generic output of the design search tool (light palette, fashion fonts,
glass style) was reviewed and rejected: it does not fit a dark 10-foot gamepad surface.

## Sources

| Source | URL | Evidence |
| --- | --- | --- |
| Community Figma file "PS5 Interactive UI (Community)" | https://www.figma.com/design/5A0xCGqosR2qf8q9hzl2qb/PS5-Interactive-UI--Community- | read in the owner's own browser session, at human speed, 2026-10-22 |
| Microsoft Xbox/TV guidance (10-foot rules) | https://learn.microsoft.com/pl-pl/windows/apps/design/devices/designing-for-tv | public docs |

The file has two pages (Page 1, Components) and about 40 frames of 1920x1080. It has no License page; the
Figma Community listing was not opened, so the licence is **unknown: treat the material as view-only**.

## Screens (from frame names; only "Discover splash" was opened)

| ID | Screen | How you get there | Purpose | States seen |
| --- | --- | --- | --- | --- |
| S01 | Login | start | choose a profile | not opened |
| S02 | Home | start | continue playing, pick a game or an app | not opened |
| S03 | Game Library | home | all games | not opened |
| S04 | App Library | home | media apps as one tile each (video, music) | not opened |
| S05 | Search | top bar | find a game or app | not opened |
| S06 | Settings | top bar | system options | not opened |
| S07 | Explore / Discover | home | store front: top navigation Latest, Deals, Collections, Subscriptions, Browse; search, wish list, cart and more icons; a hero with one primary "Play Now" action; a "Must see" shelf of promo tiles | opened |
| S08 | Per-game page (many frames) | a tile | hero art, one primary action, related shelf | not opened |
| S09 | Profile overlay | top bar | switch profile, over the current screen | not opened |
| S10 | Collection page | home | a curated list | not opened |

## Flows

- F01 Resume: S01 -> S02 -> launch the last game (fewest steps to play).
- F02 Browse: S02 -> S03 or S04 -> S08 -> launch.
- F03 Discover: S02 -> S07 -> S08 -> launch or add to wish list.
- F04 Switch profile: any screen -> S09 -> S02.

## Components (names from the Components page; variants not inspected)

Top navigation bar, tile (poster) with focus state, shelf (horizontal row), hero banner with primary action,
icon buttons (search, favourite, cart, more), profile overlay, media-app tile.

## Patterns worth carrying over (ours, written fresh)

1. One horizontal top navigation, one hero, one primary action per screen.
2. Shelves of tiles that scroll sideways, with the focused tile unmistakable (our 3 px ring).
3. Recent games first on home; the library behind it.
4. Profile and system actions in overlays that return focus to the launching tile.

## Out of scope (skip)

Game and promo art, the store catalogue and prices, trophies, parties and messages, network services,
brand marks and the console's typeface and sounds.

## Size

S for the patterns (a recent shelf, a hero with one primary action, a top bar) on the existing frontend;
the store, accounts and subscriptions are not part of this project.
