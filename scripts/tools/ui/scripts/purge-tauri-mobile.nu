#!/usr/bin/env nu
# Remove only generated Tauri mobile projects from the desktop host (aphrody-app).
# Usage: nu scripts/purge-tauri-mobile.nu [--apply]
# Tracked icons, source code, shared schemas, Rust targets and upstream Tauri are excluded.

def main [--apply] {
    let repo = ($env.FILE_PWD | path dirname | path expand --strict)
    let git_root = (^git -C $repo rev-parse --show-toplevel | str trim | path expand --strict)
    if $git_root != $repo {
        error make {msg: 'This script must live in the UI tools directory.'}
    }

    let hosts = [
        {name: 'aphrody-app', gen: 'crates/ui/app/gen'}
    ]
    mut candidates = []

    for host in $hosts {
        let gen_dir = ($repo | path join $host.gen | path expand --strict)
        for leaf in [android ios apple] {
            let raw_path = ($gen_dir | path join $leaf)
            if not ($raw_path | path exists) { continue }

            # Resolve links before checking containment. Never remove the whole gen directory:
            # it also contains desktop capability schemas.
            let target = ($raw_path | path expand --strict)
            let relative = ($target | path relative-to $gen_dir)
            if $relative != $leaf or ($target | path type) != 'dir' {
                error make {msg: $'Unexpected generated mobile target: ($raw_path)'}
            }

            let tracked = (^git -C $repo ls-files -- $'($host.gen)/($leaf)' | lines)
            if not ($tracked | is-empty) {
                error make {msg: $'Refusing to remove tracked files under ($raw_path)'}
            }

            $candidates = ($candidates | append {host: $host.name, path: $target})
        }
    }

    if ($candidates | is-empty) {
        print 'No generated Tauri mobile project found.'
    } else {
        print $candidates
        if $apply {
            for candidate in $candidates {
                rm --trash --recursive -- $candidate.path
            }
            print 'Generated mobile projects moved to the trash.'
        } else {
            print 'Dry run. Pass --apply to move these generated directories to the trash.'
        }
    }

}
