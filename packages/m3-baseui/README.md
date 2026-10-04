<!-- SPDX-License-Identifier: Apache-2.0 -->

# `@aphrody/m3-baseui`

Material 3 styling for [Base UI](https://base-ui.com) parts (`@base-ui/react`, the aphrody-labs fork lives in
`forks/base-ui`). Base UI keeps behaviour, accessibility and `data-*` state attributes; `m3-baseui.css` paints
them with the `--md-sys-*` tokens.

```tsx
import "@aphrody/m3-tokens/m3-tokens.css";
import "@aphrody/m3-baseui/m3-baseui.css";
import { M3Button, M3Switch, M3Checkbox, M3Tabs } from "@aphrody/m3-baseui";

<M3Button variant="tonal">Save</M3Button>;
```

Wrapped: Button (`filled`, `tonal`, `outlined`, `text`, `elevated`), Switch, Checkbox, Tabs. Everything else is
available unstyled through `BaseUI`. To build against the fork, point the catalog `@base-ui/react` entry at it
(`bun link` from `forks/base-ui/packages/react`).

`bun test test/`, `bun run typecheck`.
