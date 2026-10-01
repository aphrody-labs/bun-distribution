# Nushell 0.116 migration notes

Released 2026-09-26. Source: https://www.nushell.sh/blog/2026-09-26-nushell_v0_116_0.html
Check the running version with `version | get version` before applying these.

## Breaking: unified custom completions (#18791)

All completers (parameter, command-wide, external, menu sources) now receive named inputs.
Declare the ones needed as positional parameters named `token`, `place` and/or `buffer`
(any order); an unrecognised name receives `nothing` and logs a diagnostic.

- `token: record` - token at the cursor: `text`, `kind`, `span`.
- `place: record` - completion site: `cursor`, `target`, `kind`, `flag`, `index`,
  `command` (list, equivalent to the old `spans`), `shape`.
- `buffer: string` - the command line up to the cursor. Use it instead of calling
  `commandline` inside a completer.

| Before | After |
| --- | --- |
| `def comp [input pos] { ... }` | `def comp [token: record] { $token.text \| ... }` |
| `def comp [spans] { ... }` | `def comp [place: record] { $place.command \| ... }` |
| external `{\|spans\| ... }` | `{\|place: record\| ... }` |
| menu source `{\|buffer position\| ... }` | `{\|token: record\| ... }`, `{\|place: record\| ... }` or `{\|buffer: string\| ... }` |
| global `background-completions` opt-out (removed) | `@interactive` on the command that owns the terminal (fzf, `input list`) |

Output: return `null` to decline (lets file or other completion answer), a string, a list,
suggestion records, or `{completions: [...], options: {filter, completion_algorithm,
match_description}, fallback: true}`. Parameter completers are filtered by default;
command-wide and external ones are not. Failing parameter completers now return nothing
instead of falling back to file paths.

Develop completers with `commandline complete --input` (shows the `{token, place, buffer}`
record), `--detailed`, and `--type directory|path|glob|command|variable|env-var`.

## Other breaking changes

- `to yaml` / `to yml`: `--compact-list-indent` replaced by `--list-indent compact|indented`.
- List literals and `match` list patterns reject `;` separators; `[[a b];]` is a parse error.
- `format pattern` and simple `parse` patterns reject an unclosed `{` (escape as `{{`).

## Behaviour fixes that change results

- `try`/`catch`/`finally`: every `finally` between the error and the handling `catch` runs,
  innermost first; `return`, `break`, `continue` inside `try` run `finally` first. `$in` in
  `finally` (and its optional parameter) is the try/catch value on success, the error
  record on error, `nothing` on `return`/`exit`/`break`/`continue`. Workarounds for the
  0.115 nested `try/finally` issue can be removed.
- `lines --skip-empty` now skips empty and whitespace-only lines for string and byte
  streams too.
- `length`, `columns`, `is-empty` surface errors from streamed input.
- `into string` on a semver value now returns a `string`.
- Chained `par-each` no longer deadlocks on equal-size thread pools.
- `nu --mcp --mcp-transport http` binds `127.0.0.1` by default; use `--mcp-host` to change.

## Additions worth using

- Named flag given `null`: omitted if the flag type does not accept `nothing` (the default
  applies), passed through if it does (`oneof<int, nothing>`).
- Spread a record into named flags: `cmd ...{preserve: $p, recursive: true} ...$rest`.
- Row-condition syntax for `take until/while`, `skip until/while`, `chunk-by`.
- `hash sha512`, `mkdir --fail-if-exists`, `save --force` creates parent directories,
  `update cells --recursive`, `into float` accepts comma decimals, `char` gains slash and
  backslash, `std/log` structured context fields.
- `tui` command family for terminal interfaces; `nu --dap` Debug Adapter Protocol server;
  `view source --dependencies`.
