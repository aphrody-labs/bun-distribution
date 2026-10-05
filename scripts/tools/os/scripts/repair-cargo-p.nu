#!/usr/bin/env nu
# SPDX-License-Identifier: Apache-2.0
# Compatibility entry point for the shared Cargo package-token repair.
def main [...repos: path, --apply] {
    mut args = [cargo-package-repair --rename-table ($env.FILE_PWD | path join data crate-renames.json)]
    $args = ($args | append ...($repos | each {|repo| $repo | path expand}))
    if $apply { $args = ($args | append --apply) }
    ^yolo ops ...$args
}
