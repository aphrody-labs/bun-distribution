// SPDX-License-Identifier: Apache-2.0

export type FactorySourceScope = { kind: "all" } | { kind: "gitlinks"; paths: readonly string[] };

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Select root-tree gitlinks, never arbitrary directories, patterns or descendant paths. */
export function factorySourceScope(paths?: readonly string[]): FactorySourceScope {
  if (paths === undefined) return { kind: "all" };
  if (
    paths.length === 0 ||
    paths.some(
      (path) =>
        !/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/u.test(path) ||
        path.split("/").some((part) => part === "." || part === ".." || part === ".git"),
    )
  )
    throw new Error("Selected submodules require normalized relative gitlink paths");
  const selected = [...new Set(paths)].toSorted();
  if (
    selected.some((path, i) => selected.slice(i + 1).some((other) => other.startsWith(`${path}/`)))
  )
    throw new Error("Select root-tree gitlinks without overlapping descendant paths");
  return { kind: "gitlinks", paths: selected };
}

/** Run after entering the declared parent checkout, before touching selected sources. */
export function selectedSourceSetup(scope: FactorySourceScope, revision: string): string[] {
  if (scope.kind !== "gitlinks") throw new Error("An explicit gitlink source scope is required");
  return [
    "export GIT_OPTIONAL_LOCKS=0",
    "factory_scope_root=$(git rev-parse --show-toplevel)",
    `factory_scope_revision=${quote(revision)}`,
    `factory_scope_paths=(${scope.paths.map(quote).join(" ")})`,
    "factory_scope_revisions=()",
    'for factory_scope_path in "${factory_scope_paths[@]}"; do',
    '  test "$(realpath -m -- "$factory_scope_root/$factory_scope_path")" = "$factory_scope_root/$factory_scope_path" || { echo "Selected source path resolves elsewhere; preserved" >&2; exit 2; }',
    "done",
  ];
}

export function selectedSourcePrelude(scope: FactorySourceScope, revision: string): string[] {
  return [
    ...selectedSourceSetup(scope, revision),
    'for factory_scope_path in "${factory_scope_paths[@]}"; do',
    '  factory_scope_entry=$(git ls-tree "$factory_scope_revision" -- "$factory_scope_path")',
    '  case "$factory_scope_entry" in "160000 commit "*) ;; *) echo "Selected source is not a gitlink at the requested parent revision" >&2; exit 2 ;; esac',
    "  factory_scope_sha=${factory_scope_entry#160000 commit }",
    "  factory_scope_sha=${factory_scope_sha%%$'\\t'*}",
    '  [[ "$factory_scope_sha" =~ ^[a-f0-9]{40}$ ]] &&',
    "  test \"${factory_scope_entry#*$'\\t'}\" = \"$factory_scope_path\" || { echo 'Selected source is not one exact gitlink' >&2; exit 2; }",
    '  factory_scope_revisions+=("$factory_scope_sha")',
    "done",
  ];
}

const CHILD_CLEAN = String.raw`test "$(realpath -- .)" = "$factory_scope_selected_root/$displaypath" || { echo 'Selected descendant resolves elsewhere; preserved' >&2; exit 2; }
factory_scope_dirty=$(git status --porcelain --untracked-files=all --ignore-submodules=none) || { echo 'Cannot inspect selected descendant; preserved' >&2; exit 2; }
test -z "$factory_scope_dirty" || { echo 'Selected source checkout is dirty; preserved' >&2; exit 2; }`;

/** Parent files/index and the selected closure are checked; unrelated gitlinks are excluded. */
export function selectedSourceClean(): string[] {
  return [
    "factory_scope_parent_paths=(.)",
    "while IFS= read -r -d '' factory_scope_entry; do",
    '  case "$factory_scope_entry" in "160000 commit "*)',
    "    factory_scope_parent_paths+=(\":(literal,exclude)${factory_scope_entry#*$'\\t'}\") ;;",
    "  esac",
    "done < <(git ls-tree -rz --full-tree HEAD)",
    'factory_scope_dirty=$(git status --porcelain --untracked-files=all --ignore-submodules=all -- "${factory_scope_parent_paths[@]}") || { echo "Cannot inspect factory parent files; preserved" >&2; exit 2; }',
    'test -z "$factory_scope_dirty" || { echo "Factory parent source files are dirty; preserved" >&2; exit 2; }',
    'git diff --cached --quiet --ignore-submodules=none HEAD -- "${factory_scope_paths[@]}" || { echo "Selected source gitlink differs from the parent index or pin; preserved" >&2; exit 2; }',
    'git diff --quiet --ignore-submodules=dirty HEAD -- "${factory_scope_paths[@]}" || { echo "Selected source gitlink differs from the parent index or pin; preserved" >&2; exit 2; }',
    'for factory_scope_path in "${factory_scope_paths[@]}"; do',
    '  factory_scope_selected_root="$factory_scope_root/$factory_scope_path"',
    '  if [ -e "$factory_scope_selected_root/.git" ]; then',
    '    test "$(git -C "$factory_scope_selected_root" rev-parse --show-toplevel)" = "$factory_scope_selected_root" || { echo "Selected source is not its own Git root; preserved" >&2; exit 2; }',
    '    factory_scope_dirty=$(git -C "$factory_scope_selected_root" status --porcelain --untracked-files=all --ignore-submodules=none) || { echo "Cannot inspect selected source; preserved" >&2; exit 2; }',
    '    test -z "$factory_scope_dirty" || { echo "Selected source checkout is dirty; preserved" >&2; exit 2; }',
    `    factory_scope_selected_root="$factory_scope_selected_root" git -C "$factory_scope_selected_root" submodule foreach --quiet --recursive ${quote(CHILD_CLEAN)}`,
    '  elif [ -d "$factory_scope_selected_root" ]; then',
    '    test -z "$(find "$factory_scope_selected_root" -mindepth 1 -maxdepth 1 -print -quit)" || { echo "Uninitialized selected source contains unowned files; preserved" >&2; exit 2; }',
    '  elif [ -e "$factory_scope_selected_root" ]; then',
    '    echo "Selected source is not a directory; preserved" >&2; exit 2',
    "  fi",
    "done",
  ];
}

/** Existing selected roots/descendants retain the owner's no-overwrite checkout policy. */
export function selectedSourceUpdate(gitOwner: string): string[] {
  const guardedChild = [
    gitOwner,
    CHILD_CLEAN,
    'git fetch --filter=blob:none origin "$sha1"',
    'git -c submodule.recurse=false checkout --detach --no-overwrite-ignore "$sha1"',
  ].join("\n");
  return [
    'git submodule sync --recursive -- "${factory_scope_paths[@]}"',
    'for factory_scope_index in "${!factory_scope_paths[@]}"; do',
    '  factory_scope_selected_root="$factory_scope_root/${factory_scope_paths[$factory_scope_index]}"',
    '  if [ -e "$factory_scope_selected_root/.git" ]; then',
    '    git -C "$factory_scope_selected_root" fetch --filter=blob:none origin "${factory_scope_revisions[$factory_scope_index]}"',
    '    git -C "$factory_scope_selected_root" -c submodule.recurse=false checkout --detach --no-overwrite-ignore "${factory_scope_revisions[$factory_scope_index]}"',
    `    factory_scope_selected_root="$factory_scope_selected_root" git -C "$factory_scope_selected_root" submodule foreach --quiet --recursive ${quote(guardedChild)}`,
    "  fi",
    "done",
    'git -c submodule.recurse=false submodule update --init --recursive --jobs 4 --filter=blob:none -- "${factory_scope_paths[@]}"',
  ];
}

/** Pins are derived from committed gitlinks, not accepted from the caller or mutable refs. */
export function selectedSourceVerify(): string[] {
  const childPinned = [
    CHILD_CLEAN,
    'test "$(git rev-parse HEAD)" = "$sha1" || { echo "Selected descendant revision differs from its gitlink" >&2; exit 2; }',
  ].join("\n");
  return [
    'for factory_scope_index in "${!factory_scope_paths[@]}"; do',
    '  factory_scope_selected_root="$factory_scope_root/${factory_scope_paths[$factory_scope_index]}"',
    '  test -e "$factory_scope_selected_root/.git" && test "$(git -C "$factory_scope_selected_root" rev-parse HEAD)" = "${factory_scope_revisions[$factory_scope_index]}" || { echo "Selected source revision differs from its gitlink or is uninitialized" >&2; exit 2; }',
    `  factory_scope_selected_root="$factory_scope_selected_root" git -C "$factory_scope_selected_root" submodule foreach --quiet --recursive ${quote(childPinned)}`,
    "done",
    'factory_scope_status=$(git submodule status --recursive -- "${factory_scope_paths[@]}")',
    "while IFS= read -r factory_scope_line; do",
    '  case "$factory_scope_line" in [-+U]*) echo "Selected closure contains an uninitialized or mismatched descendant" >&2; exit 2 ;; esac',
    'done <<< "$factory_scope_status"',
    'printf \'{"sourceScope":{"kind":"gitlinks","parentRevision":"%s","gitlinks":[\' "$factory_scope_revision"',
    "factory_scope_separator=",
    'for factory_scope_index in "${!factory_scope_paths[@]}"; do',
    '  printf \'%s{"path":"%s","revision":"%s"}\' "$factory_scope_separator" "${factory_scope_paths[$factory_scope_index]}" "${factory_scope_revisions[$factory_scope_index]}"',
    "  factory_scope_separator=,",
    "done",
    "printf '],\"wholeRepositoryQualified\":false}}\\n'",
  ];
}
