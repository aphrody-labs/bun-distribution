<!-- SPDX-License-Identifier: Apache-2.0 -->
# Inspector variants

The inspector is composed inside `@aphrody/app-ui`; `Inspector` reads selection from the app's
`SelectionContext`. Callers render `<Inspector />` inside the explorer composition rather than
passing an `InspectorVariant` prop. `InspectorVariant` remains an exported app-ui type for the
internal view implementation.

The maintained implementation is in this directory. Data contracts come from
`@aphrody/drive-client`; generic presentation primitives come from `@aphrody/m3-primitives`.
This module is not exported by the retired `@aphrody/drive` reference package.
