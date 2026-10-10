<!-- SPDX-License-Identifier: Apache-2.0 -->
# WinClean coordination compatibility files

The five frozen `coord_*` WinClean tools are a file mirror for legacy callers. They are not
the typed A2A transport and do not create `aphrody-jobs` records. A2A's former `.coord`
mailbox was retired; the current protocol is owned outside `aphrody-os`.

By default the mirror stores `CURRENT_TASK.md`, `STATUS_<AGENT>.txt`, and `STOP` in a stable
per-user state directory: `%LOCALAPPDATA%\aphrody\coord` on Windows, or
`$XDG_STATE_HOME/aphrody/coord` on Unix (falling back to `~/.local/state/aphrody/coord`).
Set `APHRODY_COORD_ROOT` to an **absolute** path to use another directory. Relative paths
are rejected. Status and task writes replace the old file atomically; reads return an empty
value only when the file is absent and report other I/O errors.

No automatic migration from a working-directory `.coord` occurs because a kernel can start
from many directories and there is no unique source. To preserve an existing mirror, set
`APHRODY_COORD_ROOT` to its absolute path before starting the kernel, or copy the reviewed
files into the new state directory while the kernel is stopped. The `STOP` marker is read,
not created by these tools.
