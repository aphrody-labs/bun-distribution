#!/usr/bin/env nu
# SPDX-License-Identifier: Apache-2.0
# Compatibility entry point for the shared unpublished-branch attribution cleanup.
def main [repo: path, branch: string, --since: string, --apply] {
    mut args = [git-attribution --repo ($repo | path expand) --branch $branch]
    if $since != null { $args = ($args | append --since | append $since) }
    if $apply { $args = ($args | append --apply) }
    ^yolo ops ...$args
}
