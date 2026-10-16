#!/usr/bin/env nu
# Repair references broken by moves and renames between aphrody and aphrody-os.
#
#   nu scripts/fix-refs.nu links --aphrody <dir> --os <dir> --repo <aphrody|aphrody-os> [--apply]
#   nu scripts/fix-refs.nu refs  --aphrody <dir> --os <dir> --repo <aphrody|aphrody-os> [--apply]
#
# `links` repairs Markdown links (outside code blocks). `refs` repairs relative path strings in
# code and config (imports, include paths, script paths), `cargo -p <old>` package names, and
# repository paths of renamed crates. Dry run by default; `--apply` writes the files.
#
# A broken target is looked up, in order: in the rename table (scripts/data/crate-renames.json),
# at the same path in the other repository, and (links only) by a file name unique across both
# repositories. Paths are computed in a virtual namespace where the checkouts are named
# `aphrody` and `aphrody-os`, so a rewritten path stays right whatever the local directory is
# called (a worktree, for instance).

const REPOS = ["aphrody", "aphrody-os"]

def fwd [path: string]: nothing -> string { $path | str replace --all '\' '/' }

# Resolve `.` and `..` without touching the filesystem.
def normalize [path: string]: nothing -> string {
    mut out = []
    for segment in (fwd $path | split row '/') {
        if $segment == '.' or ($segment == '' and ($out | is-not-empty)) { continue }
        if $segment == '..' and ($out | is-not-empty) and ($out | last) != '..' and not (($out | last) | str ends-with ':') and ($out | last) != '' {
            $out = ($out | drop 1)
            continue
        }
        $out = ($out | append $segment)
    }
    $out | str join '/'
}

# Relative path from directory `from` to `to` (both normalized, same namespace).
def relative [from: string, to: string]: nothing -> string {
    let a = ($from | split row '/')
    let b = ($to | split row '/')
    mut i = 0
    while $i < ($a | length) and $i < ($b | length) and (($a | get $i | str lowercase) == ($b | get $i | str lowercase)) {
        $i += 1
    }
    let up = ((0..<(($a | length) - $i)) | each { '..' })
    let path = ($up | append ($b | skip $i) | str join '/')
    if $path == '' { '.' } else { $path }
}

# Context: real roots, virtual roots, rename table, file index.
def context [aphrody: path, os: path, with_index: bool] {
    let roots = {aphrody: (fwd ($aphrody | path expand)), "aphrody-os": (fwd ($os | path expand))}
    let table = (open ($env.FILE_PWD | path join data crate-renames.json))
    # An old name that another crate took over (the OAuth crate's `crates/aphrody-mcp` is now the
    # MCP server's directory) is a live reference, never a stale one: drop those rules.
    let taken_paths = ($table | each {|r| $"($r.repo):($r.to)"})
    let taken_names = ($table | get name_to | where $it != '')
    let renames = ($table
        | where {|r| not ($"aphrody:($r.from)" in $taken_paths) and not ($"aphrody-os:($r.from)" in $taken_paths)}
        | update name_from {|r| if $r.name_from in $taken_names { '' } else { $r.name_from }})
    let index = if $with_index {
        $REPOS | each {|repo|
            git -C ($roots | get $repo) -c core.quotepath=off ls-files -z | split row (char nul) | where $it != "" | each {|file| {base: ($file | path basename), virtual: $"/w/($repo)/($file)"}}
        } | flatten | group-by base
    } else { {} }
    {roots: $roots, renames: $renames, index: $index}
}

def to_real [ctx: record, virtual: string]: nothing -> any {
    let match = ($REPOS | where {|repo| $virtual == $"/w/($repo)" or ($virtual | str starts-with $"/w/($repo)/")})
    if ($match | is-empty) { return null }
    let repo = ($match | sort-by {|r| $r | str length} | last)
    ($ctx.roots | get $repo) + ($virtual | str substring (($"/w/($repo)" | str length))..)
}

def exists [ctx: record, virtual: string]: nothing -> bool {
    let real = (to_real $ctx $virtual)
    $real != null and ($real | path exists)
}

# Split a virtual path into repository and repository-relative path.
def split_repo [virtual: string]: nothing -> any {
    let match = ($REPOS | where {|repo| $virtual | str starts-with $"/w/($repo)/"} | sort-by {|r| $r | str length})
    if ($match | is-empty) { return null }
    let repo = ($match | last)
    {repo: $repo, path: ($virtual | str substring (($"/w/($repo)/" | str length))..)}
}

# Where a missing `virtual` target lives now, or null. `by_name` enables the file-name search.
def locate [ctx: record, virtual: string, by_name: bool]: nothing -> any {
    let parts = (split_repo $virtual)
    if $parts == null { return null }
    # Build outputs are local and per checkout: never redirect them to the other repository.
    if ($parts.path =~ '(^|/)(target|node_modules|dist|\.turbo)(/|$)') { return null }
    # 1. Rename table (longest `from` first).
    let hit = ($ctx.renames
        | where {|r| $parts.path == $r.from or ($parts.path | str starts-with $"($r.from)/")}
        | sort-by {|r| $r.from | str length} | reverse | first 1)
    if ($hit | is-not-empty) {
        let rule = ($hit | first)
        let candidate = $"/w/($rule.repo)/($rule.to)($parts.path | str substring (($rule.from | str length))..)"
        if (exists $ctx $candidate) { return $candidate }
    }
    # 1b. A mis-anchored relative path whose tail is a known crate path (`.../crates/<old>/...`),
    # rooted at the repository that owns the renamed crate.
    let tail_at = ($parts.path | str index-of 'crates/')
    if $tail_at > 0 {
        let tail = ($parts.path | str substring $tail_at..)
        let tail_hit = ($ctx.renames
            | where {|r| $tail == $r.from or ($tail | str starts-with $"($r.from)/")}
            | sort-by {|r| $r.from | str length} | reverse | first 1)
        if ($tail_hit | is-not-empty) {
            let rule = ($tail_hit | first)
            let candidate = $"/w/($rule.repo)/($rule.to)($tail | str substring (($rule.from | str length))..)"
            if (exists $ctx $candidate) { return $candidate }
        }
    }
    # 2. Same path in the other repository.
    for repo in ($REPOS | where $it != $parts.repo) {
        let candidate = $"/w/($repo)/($parts.path)"
        if (exists $ctx $candidate) { return $candidate }
    }
    if not $by_name { return null }
    # 3. A file name unique across both repositories, or unique within the same parent name.
    # Generic names (README.md, mod.rs, ...) only match when the two parent directories match too.
    let base = ($parts.path | path basename)
    # A bare name without extension (`test`, `docs`) is a directory or too vague to search for.
    if not ($base | str contains '.') { return null }
    let found = ($ctx.index | get -o $base | default [])
    let generic = ($base =~ '^(?i)(readme|index|claude|agents|gemini|changelog|contributing|license|skill|mod|lib|main)\.[a-z]+$|^package\.json$|^Cargo\.toml$')
    let tail = {|path: string, depth: int| $path | split row '/' | last ($depth + 1) | str join '/' | str lowercase}
    if $generic {
        let wanted = (do $tail $parts.path 2)
        let matching = ($found | where {|f| (do $tail $f.virtual 2) == $wanted})
        return (if ($matching | length) == 1 { $matching | first | get virtual } else { null })
    }
    if ($found | length) == 1 { return ($found | first | get virtual) }
    let wanted = (do $tail $parts.path 1)
    let same_parent = ($found | where {|f| (do $tail $f.virtual 1) == $wanted})
    if ($same_parent | length) == 1 { return ($same_parent | first | get virtual) }
    null
}

def is_external [url: string]: nothing -> bool {
    ($url | str starts-with '#') or ($url =~ '^[A-Za-z][A-Za-z0-9+.-]*:') or ($url | str starts-with '/') or ($url | str starts-with '{') or ($url | str contains '$')
}

# One link target (without the anchor): the fixed target, or null when nothing to do.
def fix_target [ctx: record, file_virtual: string, target: string, by_name: bool]: nothing -> any {
    let decoded = ($target | url decode)
    let dir = ($file_virtual | path dirname | fwd $in)
    let resolved = (normalize $"($dir)/($decoded)")
    if (exists $ctx $resolved) { return null }
    let found = (locate $ctx $resolved $by_name)
    if $found == null { return null }
    let rel = (relative $dir $found)
    if ($target | str ends-with '/') and not ($rel | str ends-with '/') { $"($rel)/" } else { $rel }
}

# Tracked files matching `pattern`. Files with uncommitted changes are left alone unless
# `include_dirty`: in a checkout shared with another agent they may be its work in progress.
def tracked [root: string, pattern: string, include_dirty: bool]: nothing -> list<string> {
    let dirty = if $include_dirty { [] } else {
        git -C $root -c core.quotepath=off status --porcelain=v1 -z | split row (char nul) | where $it != "" | each {|l| $l | str substring 3..}
    }
    if ($dirty | is-not-empty) { print $"skipping ($dirty | length) file\(s) with uncommitted changes \(--include-dirty to override)" }
    git -C $root -c core.quotepath=off ls-files -z | split row (char nul) | where {|f| $f != "" and $f =~ $pattern and not ($f in $dirty) and ($"($root)/($f)" | path exists)}
}

def skipped [file: string]: nothing -> bool {
    $file =~ '(^|/)(CHANGELOG[^/]*|llms\.txt|SUMMARY\.md)$|^crates/(aphrody-obscura|tauri|tauri-plugins)/|node_modules/|\.lock$|lock\.json$'
}

def report [changes: list, apply: bool, unresolved: list] {
    for change in $changes { print $"($change.kind)	($change.file): ($change.old) -> ($change.new)" }
    print $"($changes | length) change\(s) in ($changes | get file | uniq | length) file\(s); ($unresolved | length) broken reference\(s) left \(no unique target)."
    if not $apply and ($changes | is-not-empty) { print "dry run: pass --apply to write the files" }
}

# Repair Markdown links.
def "main links" [--aphrody: path, --os: path, --repo: string, --apply, --include-dirty] {
    let ctx = (context $aphrody $os true)
    let root = ($ctx.roots | get $repo)
    mut changes = []
    mut unresolved = []
    for file in (tracked $root '\.md$' $include_dirty | where {|f| not (skipped $f)}) {
        let real = $"($root)/($file)"
        let text = (open --raw $real)
        let file_virtual = $"/w/($repo)/($file)"
        mut fence = false
        mut lines = []
        for line in ($text | split row "\n") {
            mut current = $line
            if ($line =~ '^\s*(```|~~~)') { $fence = not $fence }
            if not $fence and ($line | str contains '](') {
                for url in ($line | parse --regex '\]\((?<url>[^)\s<>]+)\)' | get url) {
                    if (is_external $url) { continue }
                    let target = ($url | split row '#' | first)
                    let anchor = ($url | str substring (($target | str length))..)
                    if $target == '' { continue }
                    let fixed = (fix_target $ctx $file_virtual $target true)
                    if $fixed == null {
                        let resolved = (normalize $"($file_virtual | path dirname | fwd $in)/($target | url decode)")
                        if not (exists $ctx $resolved) and (split_repo $resolved) != null {
                            $unresolved = ($unresolved | append {file: $file, url: $url})
                        }
                        continue
                    }
                    let replacement = $"($fixed)($anchor)"
                    $current = ($current | str replace --all $"]\(($url)\)" $"]\(($replacement)\)")
                    $changes = ($changes | append {file: $file, kind: link, old: $url, new: $replacement})
                }
            }
            $lines = ($lines | append $current)
        }
        let updated = ($lines | str join "\n")
        if $apply and $updated != $text { $updated | save --force --raw $real }
    }
    report $changes $apply $unresolved
    if not $apply { $unresolved | save --force ($env.TEMP? | default "/tmp" | path join $"fix-refs-unresolved-($repo).json") }
}

# Repair relative path strings, cargo package names and repository paths in code and config.
def "main refs" [--aphrody: path, --os: path, --repo: string, --apply, --include-dirty] {
    let ctx = (context $aphrody $os false)
    let root = ($ctx.roots | get $repo)
    let packages = ($ctx.renames | where {|r| $r.name_from != '' and $r.name_from != $r.name_to})
    let dirs = ($ctx.renames | where {|r| ($r.from | str contains '/') and ($r.from != $r.to or $r.repo != $repo)} | sort-by {|r| $r.from | str length} | reverse)
    mut changes = []
    let pattern = '\.(md|toml|ya?ml|ts|tsx|mts|js|mjs|sh|ps1|psm1|nu|py|json|rs)$|(^|/)(justfile|Dockerfile)$'
    for file in (tracked $root $pattern $include_dirty | where {|f| not (skipped $f)}) {
        let real = $"($root)/($file)"
        # Minified catalogs and generated data are too large for the regex engine (Nushell
        # panics on fancy-regex's backtrack limit) and carry nothing to repair by hand.
        if (ls $real | get 0.size) > 512kb { continue }
        let text = (open --raw $real)
        mut updated = $text
        let file_virtual = $"/w/($repo)/($file)"
        # 1. Quoted relative paths that no longer resolve (imports, include_str!, script paths).
        let quoted = if ($text | str contains './') {
            $text | parse --regex '["''`](?<p>\.{1,2}/[^"''`\s)]+)["''`]' | get p | uniq
        } else { [] }
        for rel in $quoted {
            let fixed = (fix_target $ctx $file_virtual $rel false)
            if $fixed != null and $fixed != $rel {
                $updated = ($updated | str replace --all $rel $fixed)
                $changes = ($changes | append {file: $file, kind: path, old: $rel, new: $fixed})
            }
        }
        # 2. `cargo -p <old>` / `--package <old>`.
        for rule in $packages {
            if not ($updated | str contains $rule.name_from) { continue }
            let re = $"\(-p|--package\)\(\\s+|=\)($rule.name_from)\(?![\\w-]\)"
            if ($updated =~ $re) {
                $updated = ($updated | str replace --all --regex $re $"${1}${2}($rule.name_to)")
                $changes = ($changes | append {file: $file, kind: package, old: $rule.name_from, new: $rule.name_to})
            }
        }
        # 3. Repository paths of renamed or moved crates, outside Rust sources.
        if not ($file | str ends-with '.rs') {
            for rule in $dirs {
                if not ($updated | str contains $rule.from) { continue }
                let re = $"\(?<![\\w./-]\)($rule.from | str replace --all '.' '\.')\(?=[/\"'`\\s\)\\]:,;|>]|$\)"
                if ($updated =~ $re) {
                    let to = if $rule.repo == $repo { $rule.to } else { $"../($rule.repo)/($rule.to)" }
                    $updated = ($updated | str replace --all --regex $re $to)
                    $changes = ($changes | append {file: $file, kind: repo-path, old: $rule.from, new: $to})
                }
            }
        }
        if $apply and $updated != $text { $updated | save --force --raw $real }
    }
    report $changes $apply []
}

def main [] {
    print "usage: nu scripts/fix-refs.nu (links|refs) --aphrody <dir> --os <dir> --repo <aphrody|aphrody-os> [--apply]"
}
