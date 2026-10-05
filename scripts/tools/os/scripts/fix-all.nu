#!/usr/bin/env nu
# SPDX-License-Identifier: Apache-2.0
# Compatibility entry point for the shared cross-workspace repair orchestration.
def main [--aphrody: path, --os: path, --repo: string, --apply, --include-dirty] {
    mut args = [workspace-repair --ai-root ($aphrody | path expand) --os-root ($os | path expand) --repo $repo]
    if $apply { $args = ($args | append --apply) }
    if $include_dirty { $args = ($args | append --include-dirty) }
    ^yolo ops ...$args
}
