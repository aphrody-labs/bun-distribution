#!/usr/bin/env nu
# Build scripts/data/crate-renames.json from the 2026-09-21 reorganisation report.
#
#   nu scripts/data/make-renames.nu <reorg-report.json> <aphrody root> <aphrody-os root>
#
# Each entry maps a pre-reorganisation path or package to where it lives now, and in
# which repository: `from` / `name_from` (old directory, old package name) and `repo` /
# `to` / `name_to` (repository, new directory, new package name).

def main [report: path, aphrody: path, os: path] {
    let generated = (open $report | each {|entry|
        let name = $entry.newName
        let location = if ($aphrody | path join crates $name | path exists) {
            {repo: "aphrody", to: $"crates/($name)"}
        } else if ($os | path join crates $name | path exists) {
            {repo: "aphrody-os", to: $"crates/($name)"}
        } else if ($os | path join crates aphrody-obscura crates $name | path exists) {
            {repo: "aphrody-os", to: $"crates/aphrody-obscura/crates/($name)"}
        } else if ($aphrody | path join $entry.oldDir Cargo.toml | path exists) {
            {repo: "aphrody", to: $entry.oldDir}
        } else {
            {repo: "", to: ""}
        }
        {from: $entry.oldDir, name_from: $entry.name, repo: $location.repo, to: $location.to, name_to: $name}
    })
    let unresolved = ($generated | where to == "")
    if ($unresolved | is-not-empty) {
        error make {msg: $"no current location for: ($unresolved | get name_from | str join ', ')"}
    }
    # Moves the report does not list.
    let manual = [
        {from: "native/bxc-rust-bridge/vendor", name_from: "", repo: "aphrody-os", to: "crates/aphrody-obscura/vendor", name_to: ""}
        {from: "crates/a2a-slimrpc", name_from: "a2a-slimrpc", repo: "aphrody", to: "crates/aphrody-a2a-slimrpc", name_to: "aphrody-a2a-slimrpc"}
        {from: "packages/x", name_from: "", repo: "aphrody-os", to: "packages/x", name_to: ""}
        {from: "packages/xai", name_from: "", repo: "aphrody-os", to: "packages/xai", name_to: ""}
    ]
    let all = ($generated | append $manual | where from != to or repo != "aphrody" | sort-by from)
    $all | to json | save -f ($env.FILE_PWD | path join crate-renames.json)
    print $"($all | length) entries -> scripts/data/crate-renames.json"
}
