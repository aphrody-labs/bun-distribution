#!/usr/bin/env nu

# Read-only inventory of Aphrody Rust crate reuse and copied source.
# The default UI root is resolved from this script, so invocation cwd is irrelevant.
def has-path-dependency [specification] {
  if (($specification | describe) | str starts-with "record<") {
    ($specification | get -o path | is-not-empty)
  } else {
    false
  }
}

def has-git-dependency [specification] {
  if (($specification | describe) | str starts-with "record<") {
    ($specification | get -o git | is-not-empty)
  } else {
    false
  }
}

def crate-publication [path: string] {
  let manifest = ($path | path join "Cargo.toml")
  if not ($manifest | path exists) {
    {package: "", policy: "manifest-missing", crates_io_allowed: false}
  } else {
    let package = ((open $manifest) | get -o package)
    if ($package | is-empty) {
      {package: "", policy: "package-missing", crates_io_allowed: false}
    } else {
      let policy = ($package | get -o publish)
      if ($policy | is-empty) {
        {package: $package.name, policy: "default", crates_io_allowed: true}
      } else if (($policy | describe) | str starts-with "bool") {
        {package: $package.name, policy: (if $policy { "enabled" } else { "disabled" }),
          crates_io_allowed: $policy}
      } else if (($policy | describe) | str starts-with "list") {
        {package: $package.name, policy: ($policy | str join ","),
          crates_io_allowed: ($policy | any {|registry| $registry == "crates-io"})}
      } else {
        {package: $package.name, policy: "workspace-inherited", crates_io_allowed: null}
      }
    }
  }
}

def is-vendored-path [path: string] {
  (
    ($path | str contains "/vendor/") or ($path | str contains "/vendors/") or
    ($path | str contains "/third_party/") or ($path | str contains "/third-party/") or
    ($path | str contains "/thirdparty/") or ($path | str contains "/patches/")
  )
}

def is-ui-path [path: string, ui_root: string] {
  let absolute_path = ($path | path expand)
  let absolute_ui = ($ui_root | path expand)
  ($absolute_path == $absolute_ui) or ($absolute_path | str starts-with ($absolute_ui | path join ""))
}

def is-path-under [path: string, parent: string] {
  let absolute_path = ($path | path expand)
  let absolute_parent = ($parent | path expand)
  ($absolute_path == $absolute_parent) or ($absolute_path | str starts-with ($absolute_parent | path join ""))
}

def manifest-dependency-sections [data] {
  let ordinary_sections = [
    ($data | get -o dependencies)
    ($data | get -o "dev-dependencies")
    ($data | get -o "build-dependencies")
  ] | compact
  let target_sections = (($data | get -o target | default {}) | values | each {|target|
    [
      ($target | get -o dependencies)
      ($target | get -o "dev-dependencies")
      ($target | get -o "build-dependencies")
    ] | compact
  } | flatten)
  $ordinary_sections | append $target_sections
}

def main [--ui-root: string = "", --skip-ui] {
  let infra_root = ($env.FILE_PWD | path dirname)
  let workspace_root = ($infra_root | path dirname)
  let ui = if ($ui_root | is-empty) {
    ($workspace_root | path join "aphrody-ui")
  } else if $skip_ui {
    # Normalize a caller-provided root without requiring it to exist or opening its manifest.
    ($ui_root | path expand)
  } else {
    ($ui_root | path expand --strict)
  }
  let manifest = ($ui | path join "Cargo.toml")
  if not $skip_ui and not ($manifest | path exists) {
    error make {msg: $"UI Cargo.toml not found: ($manifest)"}
  }

  let workspace = ($ui | path dirname)
  let repos = (glob ($workspace + "/aphrody-*") | where {|repo|
    not ($skip_ui and (($repo | path basename) == "aphrody-ui"))
  })
  if $skip_ui {
    print $"Aphrody first-party crate audit without UI — workspace: ($workspace)"
  } else {
    print $"Aphrody UI crate audit: ($ui)"
  }
  let local = if $skip_ui { [] } else {
    let manifests = (glob ($ui + "/crates/**/Cargo.toml") | where {|file| not (is-vendored-path $file)})
    $manifests | each { |file|
      let data = (open $file)
      if ($data | get -o package | is-empty) { null } else { {name: $data.package.name, manifest_path: $file} }
    } | compact | sort-by name
  }
  if $skip_ui { print "UI crate listing skipped" } else {
    print $"\nLocal crates in UI workspace: ($local | length)"
    $local | select name manifest_path | print
  }

  let duplicate_names = ($local | group-by name | transpose name packages | where ($it.packages | length) > 1)
  if $skip_ui {
    print "UI-local duplicate check skipped"
  } else if ($duplicate_names | is-empty) { print "Duplicate local crate names: none" } else {
    print "Duplicate local crate names:"
    $duplicate_names | each { |group| {name: $group.name, manifests: ($group.packages | get manifest_path | str join ", ")} } | print
  }

  # Compare all first-party Aphrody crates too, so copies split across owner repos are visible.
  let ecosystem_manifests = ($repos | each {|repo| glob ($repo + "/crates/**/Cargo.toml")} | flatten
    | where {|file| not (is-vendored-path $file)})
  let ecosystem_crates = ($ecosystem_manifests | each { |file|
    let data = (open $file)
    if ($data | get -o package | is-empty) { null } else {
      {name: $data.package.name, manifest_path: $file}
    }
  } | compact)
  let ecosystem_duplicates = ($ecosystem_crates | group-by name | transpose name packages | where ($it.packages | length) > 1)
  print $"\nFirst-party crates across Aphrody repos: ($ecosystem_crates | length)"
  if ($ecosystem_duplicates | is-empty) { print "Cross-repo duplicate crate names: none" } else {
    print "Cross-repo duplicate crate names:"
    $ecosystem_duplicates | each { |group| {name: $group.name,
      manifests: ($group.packages | get manifest_path | each {|p| $p | str replace $"($workspace)/" ""} | str join ", ")} } | print
  }

  let workspace_manifests = ($repos | each {|repo| $repo | path join "Cargo.toml"} | where {|path| $path | path exists})
  let workspace_manifests = if $skip_ui { $workspace_manifests } else {
    $workspace_manifests | append $manifest | uniq
  }
  let paths = ($workspace_manifests | each { |file|
    let owner_root = ($file | path dirname)
    let dependency_table = ((open $file) | get -o workspace.dependencies)
    if ($dependency_table | is-empty) { [] } else {
      $dependency_table | transpose dependency specification
      | where {|dep| has-path-dependency $dep.specification}
      | each { |dep|
        let path = ($owner_root | path join $dep.specification.path)
        let ui_target = ($skip_ui and (is-ui-path $path $ui))
        let publication = if $ui_target {
          {package: "", policy: "ui-skipped", crates_io_allowed: null}
        } else { crate-publication $path }
        let version = ($dep.specification | get -o version | default "")
        {owner: ($owner_root | path basename), dependency: $dep.dependency,
          manifest: ($file | str replace $"($workspace)/" ""),
          path: $dep.specification.path, version: $version,
          package: $publication.package, publish_policy: $publication.policy,
          crates_io_allowed: $publication.crates_io_allowed,
          crates_io_candidate: ($publication.crates_io_allowed == true and not ($version | is-empty)),
          exists: (if $ui_target { null } else { $path | path exists })}
      }
    }
  } | flatten | sort-by owner dependency)
  let crate_manifests = $ecosystem_manifests
  let crate_paths = ($crate_manifests | each { |file|
    let crate_root = ($file | path dirname)
    let data = (open $file)
    let sections = (manifest-dependency-sections $data)
    $sections | each {|section|
      $section | transpose dependency specification
      | where {|dep| has-path-dependency $dep.specification}
      | each {|dep|
        let path = ($crate_root | path join $dep.specification.path)
        let ui_target = ($skip_ui and (is-ui-path $path $ui))
        let publication = if $ui_target {
          {package: "", policy: "ui-skipped", crates_io_allowed: null}
        } else { crate-publication $path }
        let version = ($dep.specification | get -o version | default "")
        {owner: ($file | path dirname | path dirname | path dirname | path basename),
          manifest: ($file | str replace $"($workspace)/" ""), dependency: $dep.dependency,
          path: $dep.specification.path, version: $version,
          package: $publication.package, publish_policy: $publication.policy,
          crates_io_allowed: $publication.crates_io_allowed,
          crates_io_candidate: ($publication.crates_io_allowed == true and not ($version | is-empty)),
          exists: (if $ui_target { null } else { $path | path exists })}
      }
    } | flatten
  } | flatten)
  let all_paths = ($paths | append $crate_paths | sort-by owner manifest dependency)
  print $"\nWorkspace/crate path dependencies across first-party repos, review for crates.io candidates: ($all_paths | length)"
  $all_paths | print
  let missing_paths = ($all_paths | where exists == false)
  if not ($missing_paths | is-empty) {
    print "Missing path dependencies; Cargo metadata/build cannot resolve these entries:"
    $missing_paths | select owner manifest dependency path | print
  }
  let crates_io_paths = ($all_paths | where crates_io_candidate == true)
  print $"Static crates.io path candidates allowed by package policy and carrying a version: ($crates_io_paths | length)"
  $crates_io_paths | each {|item|
    $"  ($item.owner): ($item.dependency) -> ($item.package)@($item.version) [($item.path)]"
  } | str join "\n" | print
  let workspace_git_deps = ($workspace_manifests | each {|file|
    let owner_root = ($file | path dirname)
    let dependencies = ((open $file) | get -o workspace.dependencies)
    if ($dependencies | is-empty) { [] } else {
      $dependencies | transpose dependency specification
      | where {|dep| has-git-dependency $dep.specification}
      | each {|dep| {owner: ($owner_root | path basename), dependency: $dep.dependency,
          manifest: ($file | str replace $"($workspace)/" ""),
          git: $dep.specification.git, rev: ($dep.specification | get -o rev)} }
    }
  } | flatten | sort-by owner dependency)
  let crate_git_deps = ($crate_manifests | each {|file|
    let data = (open $file)
    (manifest-dependency-sections $data) | each {|section|
      $section | transpose dependency specification
      | where {|dep| has-git-dependency $dep.specification}
      | each {|dep| {owner: ($file | path dirname | path dirname | path dirname | path basename),
          manifest: ($file | str replace $"($workspace)/" ""), dependency: $dep.dependency,
          git: $dep.specification.git, rev: ($dep.specification | get -o rev)} }
    } | flatten
  } | flatten)
  let git_deps = ($workspace_git_deps | append $crate_git_deps | sort-by owner manifest dependency)
  print $"\nGit dependencies across first-party workspace/crate manifests: ($git_deps | length)"
  $git_deps | print
  let patches = ($workspace_manifests | each {|file|
    let owner_root = ($file | path dirname)
    let patch_table = ((open $file) | get -o patch."crates-io")
    if ($patch_table | is-empty) { [] } else {
      $patch_table | transpose dependency specification
      | where {|dep| (has-path-dependency $dep.specification) or (has-git-dependency $dep.specification)}
      | each {|dep|
        let patch_path = ($dep.specification | get -o path | default "")
        let full_patch_path = if ($patch_path | is-empty) { "" } else { $owner_root | path join $patch_path }
        let ui_target = ($skip_ui and not ($full_patch_path | is-empty) and (is-ui-path $full_patch_path $ui))
        {owner: ($owner_root | path basename), dependency: $dep.dependency, path: $patch_path,
          git: ($dep.specification | get -o git), rev: ($dep.specification | get -o rev),
          exists: (if ($patch_path | is-empty) { true } else if $ui_target { null } else { $full_patch_path | path exists })}
      }
    }
  } | flatten | sort-by owner dependency)
  if not ($patches | is-empty) {
    print "\nLocal/Git Cargo patches across first-party repos:"
    $patches | print
  }

  let lock_files = ($repos | each {|repo| glob ($repo + "/Cargo.lock")} | flatten)
  let lock_records = ($lock_files | each { |file|
    let data = (open --raw $file | from toml)
    let packages = ($data.package | where {|pkg|
      (($pkg | get -o source | default "") | str starts-with "registry+")
    })
    let multi = ($packages | group-by name | transpose crate versions | where ($it.versions | length) > 1)
    let extra_versions = if ($multi | is-empty) { 0 } else {
      ($multi | each {|group| ($group.versions | length) - 1} | math sum)
    }
    {
      repo: ($file | path dirname | path basename),
      entries: ($data.package | length),
      registry_entries: ($packages | length),
      multi_version_names: ($multi | length),
      extra_versions: $extra_versions,
      registry_packages: ($packages | each {|pkg| {repo: ($file | path dirname | path basename), crate: $pkg.name, version: $pkg.version}})
    }
  } | sort-by repo)
  print $"\nCargo lockfiles inventoried: ($lock_records | length)"
  $lock_records | select repo entries registry_entries multi_version_names extra_versions | print
  let all_registry = ($lock_records | get registry_packages | flatten)
  let shared_versions = ($all_registry | group-by crate | transpose crate packages
    | each {|group|
      let versions = ($group.packages | get version | uniq | sort)
      let repos = ($group.packages | get repo | uniq | sort)
      {crate: $group.crate, versions: ($versions | str join ", "),
        version_count: ($versions | length), repos: ($repos | str join ", "), repo_count: ($repos | length)}
    } | where version_count > 1 | sort-by repo_count --reverse)
  print $"Registry crates with version skew across independent repo lockfiles: ($shared_versions | length)"
  $shared_versions | first 25 | print
  let ui_lock = if $skip_ui { [] } else { $lock_records | where repo == "aphrody-ui" | first }
  if not $skip_ui and not ($ui_lock | is-empty) {
    let ui_packages = ($ui_lock.registry_packages)
    let ui_versions = ($ui_packages | group-by crate | transpose crate packages | where ($it.packages | length) > 1
      | each { |group| {crate: $group.crate, copies: ($group.packages | length),
          versions: ($group.packages | get version | str join ", ")} }
      | sort-by copies --reverse)
    print "Largest UI lockfile version groups (inventory only; check `cargo tree -d` after the workspace resolves):"
    $ui_versions | first 20 | print
  }

  let rust_files = ($repos | each {|repo| glob ($repo + "/crates/**/src/**/*.rs")} | flatten | where {|p| (
    not ($p | str contains "/target/") and not (is-vendored-path $p)
  ) })
  let fingerprints = ($rust_files | each { |file| {
    hash: (open --raw $file | hash sha256), path: $file
  } })
  let duplicates = ($fingerprints | group-by hash | transpose sha256 files | where ($it.files | length) > 1)
  print $"\nIdentical Rust source files across first-party crates: ($duplicates | length) groups"
  $duplicates | each { |group| {sha256: $group.sha256, paths: ($group.files | get path | each {|p| $p | str replace $"($workspace)/" ""} | str join ", ")} } | print

  print "\nVendor, third-party and local patch source footprint across Aphrody repos (du -sh; read-only):"
  if not $skip_ui { print "Inventory only: maintained UI forks such as base-ui and Tailwind CSS stay under their UI owners." }
  let copied = ($repos | each {|repo|
    glob ($repo + "/**/*") --no-file --no-symlink --exclude [**/.git/** **/target/** **/node_modules/** **/dist/** **/.bun-cache/** **/.venv/** **/venv/** **/.tox/** **/.nox/**]
    | where {|p| ($p | path basename) in ["vendor", "vendors", "third_party", "third-party", "thirdparty", "patches"]}
  } | flatten | uniq | sort)
  # Nested labels (for example third_party/**/patches) would hash/count the
  # same files twice, so use only outermost roots for content inventories.
  let copy_roots = ($copied | where {|candidate|
    not ($copied | any {|other| $other != $candidate and (is-path-under $candidate $other)})
  })
  if ($copy_roots | is-empty) { print "No vendor/third-party/local patch directories found" } else {
    $copy_roots | each { |dir| ^du -sh $dir | str trim } | print
  }
  let generated_names = ["target", "dist", "node_modules", ".bun-cache", ".venv", "venv", ".tox", ".nox"]
  let generated = ($copy_roots | each {|root|
    $generated_names | each {|name| glob ($root + "/**/" + $name) }
  } | flatten | flatten | uniq | sort)
  print $"\nGenerated output directories inside vendor/patch trees: ($generated | length)"
  $generated | each { |dir| ^du -sh $dir | str trim } | print

  let copied_manifests = ($copy_roots | each {|root|
    glob ($root + "/**/Cargo.toml") --exclude [**/.git/** **/target/** **/node_modules/** **/dist/** **/.bun-cache/** **/.venv/** **/venv/** **/.tox/** **/.nox/**]
  } | flatten | uniq | sort)
  let copied_crates = ($copied_manifests | each {|file|
    let package = ((open $file) | get -o package)
    if ($package | is-empty) { null } else {
      let publication = (crate-publication ($file | path dirname))
      let version = ($package | get -o version | default "")
      {name: $package.name, version: $version, publish_policy: $publication.policy,
        crates_io_candidate: ($publication.crates_io_allowed == true and (($version | describe) | str starts-with "string") and not ($version | is-empty)),
        manifest: $file}
    }
  } | compact)
  let copied_crate_names = ($copied_crates | get name | uniq)
  let vendored_name_duplicates = ($copied_crates | group-by name | transpose name packages | where ($it.packages | get manifest | uniq | length) > 1)
  let first_party_vendor_overlap = ($copied_crate_names | where {|name| $ecosystem_crates.name | any {|first_party| $first_party == $name}})
  let copied_crates_io = ($copied_crates | where crates_io_candidate)
  print $"\nCargo package manifests under copied source: ($copied_manifests | length); packages: ($copied_crates | length)"
  print $"Repeated package names among copied sources: ($vendored_name_duplicates | length) groups"
  $vendored_name_duplicates | each {|group| print $"  ($group.name): (($group.packages | get manifest | str join ", "))"}
  print $"Copied package names also owned by first-party crates: ($first_party_vendor_overlap | length)"
  $first_party_vendor_overlap | each {|name| print $"  ($name)"}
  print $"Static publishable copied crates with declared versions: ($copied_crates_io | length)"
  $copied_crates_io | each {|package| print $"  ($package.name)@($package.version) [($package.manifest)]"}

  let copied_rust_files = ($copy_roots | each {|root|
    glob ($root + "/**/*.rs") --exclude [**/.git/** **/target/** **/node_modules/** **/dist/** **/.bun-cache/** **/.venv/** **/venv/** **/.tox/** **/.nox/**]
  } | flatten | uniq | sort)
  let copied_fingerprints = ($copied_rust_files | each {|file|
    {hash: (open --raw $file | hash sha256), path: $file}
  })
  let copied_duplicates = ($copied_fingerprints | group-by hash | transpose sha256 files | where ($it.files | length) > 1)
  print $"Identical Rust source files across copied trees: ($copied_duplicates | length) groups"
  $copied_duplicates | each {|group| print $"  ($group.files | get path | str join ", ")"}

  print "\nIdentical hashes are exact copies. Path/Git dependencies and copied trees need owner, API, license, and publication review before migration."
}
