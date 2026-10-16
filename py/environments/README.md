<!-- SPDX-License-Identifier: Apache-2.0 -->
# Python environment profiles

All projects share the root uv lock and `.venv` by default. The workspace
baseline is CPython 3.12: it satisfies the training package's explicit
`>=3.12,<3.13` range and the other imported package minimums.

Keep heavyweight or platform-specific dependencies opt-in at the owning
package:

- AI image, document and voice features use extras on `aphrody`.
- Training acceleration is declared by `aphrody-train` with its CUDA index and
  optional `full` extra.
- Blender scripts run through the Blender interpreter and its bundled Python;
  they are not expected to run in the shared environment without `bpy`.
- Ren'Py and game-native tools use their own embedded/native runtime contracts.

The shared lock resolves a common Python range; it does not isolate optional
providers. Keep CUDA, Blender and other incompatible runtime profiles in separate
environments. Independently installed wheels are checked in fresh environments.
The SDK supports Python 3.11+ independently of the complete workspace; its
standalone lock and the training lock are checked outside workspace discovery.

Linux is the supported platform; see [Linux contracts](../docs/sdk/linux.md).
