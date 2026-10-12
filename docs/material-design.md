# Material Design 3

## Principles

Material Design 3 organizes interfaces around reusable components and semantic
tokens. Tokens describe visual intent, while components apply those values to
their structure and states.

## Color

Color roles distinguish surfaces, content, outlines, and accent colors. A
light/dark pair should preserve readable contrast and consistent relationships
between roles.

## States and interaction

Components expose explicit states: rest, hover, focus, pressed, selected,
disabled, and error. States should not depend on a single color; they should
remain identifiable with appropriate contrast.

## Themes

A theme groups color, typography, shape, and elevation tokens. Token packages
produce values consumed by components and stylesheets. Applications can define
a custom color source without modifying components.

## Development with m3-bun

`m3-bun` provides Bun tooling for checks, tests, and development commands for
M3 packages. It does not define the design system; it runs and distributes it.
