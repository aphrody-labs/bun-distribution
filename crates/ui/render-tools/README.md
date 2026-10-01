<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-render3d (`crates/ui/render-tools`)

Kernel-facing 3D subsystem for agents. It does **not** implement rendering: the
engine (GPU pipeline, deterministic CPU fallback, scene graph, glTF/OBJ model
loading) lives in [`aphrody-render`](../render), and the dependency-free CPU
rasterizer in [`aphrody-softraster`](../softraster).

| Crate | Directory | Role |
| --- | --- | --- |
| `aphrody-render` | `crates/ui/render` | Rendering engine and contracts (library). |
| `aphrody-softraster` | `crates/ui/softraster` | Byte-deterministic CPU rasterizer. |
| `aphrody-render3d` | `crates/ui/render-tools` | `render3d_*` tools exposed through `aphrody-subsystem`, plus the `aphrody-render3d-mcp` plugin binary. |

The directory name is historical; the public crate name `aphrody-render3d` and
the `aphrody-render3d-mcp` binary are compatibility contracts. Any rename of
either goes through an explicit versioned migration, not a path move.

Put new rendering capability in `aphrody-render`; put only tool definitions,
argument validation and file/PNG/GLB plumbing for agents here.
