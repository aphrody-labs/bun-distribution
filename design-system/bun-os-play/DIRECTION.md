# Bun OS Play: art direction

Applies to play.aphrody.app and the Bun OS console shell. MASTER.md gives the tokens; this file
decides how to spend them. Subject: a console OS whose content is the player's own games (Steam
library, emulated systems, streams). Audience: one player on a TV or desk, controller in hand.
Primary job: pick a game and be playing in two presses.

## The one bold thing

The focused game's real art owns the screen. Its hero image runs full-bleed behind the rail. The
whole M3 scheme is regenerated from that art (dynamic color: seed taken from the image's dominant
hue, tonal palettes via the M3 color algorithm), so surfaces, the focus ring and the rail re-tint
with every game, as on a console home screen. Everything else stays quiet: no gradients for
decoration, no glass, no drop shadows used as ornament.

## Tokens

- **Color:** M3 dynamic scheme per focused game (dark scheme). With no game focused, use the
  M3 baseline dark from MASTER.md. Text sits on scrims measured against the real art (4.5:1).
  Avoid a near-black field with a single acid accent: no NVIDIA green as a UI accent.
- **Type:** Google Sans Flex only. The game title is the display element: optical size and
  width axes set large on the hero, tight tracking. UI text in sentence case. No all-caps
  eyebrows, no monospace data labels.
- **Shape:** M3 shape scale by hierarchy. Game tiles take medium corners and the focused tile
  scales 1.08 with the focus ring; menus take large corners; chips stay full. Do not apply one
  radius to everything.
- **Layout:** a single horizontal rail of real capsule art, a hero zone above it, and a quick
  menu that slides from the side over a scrim. Left-aligned text. No card grids of identical
  boxes, and no numbered markers unless the content is a real sequence (download queue order).

```
+--------------------------------------------------------------+
|  [hero art, full bleed]                                      |
|  Title in display type                                       |
|  Play   Stream from vps   ...                                |
|                                                              |
|  [tile][TILE*][tile][tile][tile]           system  time  pad |
+--------------------------------------------------------------+
```

## Motion

One orchestrated moment: on focus change, the hero cross-fades and the scheme re-tints together
(~300 ms, M3 emphasized easing). Everything else is a response to input: press feedback, the
quick menu slide, game launch. No entrance animations on load beyond the first hero reveal.
Honor reduced motion: cut the re-tint to an instant swap.

## Words

Plain verbs that say what happens: "Play", "Stream from vps-203bea89", "Resume", "Install on
VPS". The same action keeps its name in the toast ("Streaming…", "Resumed"). Empty states
invite action ("No emulated games yet. Add a ROM folder"). Errors say what failed and what to
do, without apologies.

## Assets

Real art only: Steam library cache or CDN art, libretro-thumbnails, official brand assets under
their rules, and Material Symbols for icons. When no art exists, render a typographic tile from
the real title and system name. No placeholders, no lorem ipsum, no generated imagery.
