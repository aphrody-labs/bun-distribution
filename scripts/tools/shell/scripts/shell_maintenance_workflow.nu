# SPDX-License-Identifier: Apache-2.0
# Compatibility entry point for the shared workspace artifact cleanup operation.
def main [
    --dry-run (-d)
    --skip-hashes (-s)
] {
    mut args = []
    if $dry_run { $args = ($args | append "--dry-run") }
    if $skip_hashes { $args = ($args | append "--skip-hashes") }
    ^yolo ops workspace-clean --root $env.PWD ...$args
}
