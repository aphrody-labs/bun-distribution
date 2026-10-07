// SPDX-License-Identifier: Apache-2.0
//! Commands that operate on shell bytes and the synchronous VFS, without host I/O.
//!
//! uutils 0.12 utility entry points write to process stdout and several open
//! `std::fs::File`; they cannot be safely redirected to a browser `Vfs`. Each
//! command here therefore declares its `own` source in one registry table.

use aphrody_shell_vfs::{Vfs, path};

/// Provenance for a registered command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// Small implementation over the shell's byte stream and VFS.
    Own,
}

/// One utility exposed by the registry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Utility {
    /// Command name.
    pub name: &'static str,
    /// Implementation provenance.
    pub source: Source,
}

const UTILITIES: &[Utility] = &[
    Utility { name: "basename", source: Source::Own },
    Utility { name: "cat", source: Source::Own },
    Utility { name: "cut", source: Source::Own },
    Utility { name: "dirname", source: Source::Own },
    Utility { name: "echo", source: Source::Own },
    Utility { name: "false", source: Source::Own },
    Utility { name: "head", source: Source::Own },
    Utility { name: "printf", source: Source::Own },
    Utility { name: "seq", source: Source::Own },
    Utility { name: "sort", source: Source::Own },
    Utility { name: "tail", source: Source::Own },
    Utility { name: "tee", source: Source::Own },
    Utility { name: "tr", source: Source::Own },
    Utility { name: "true", source: Source::Own },
    Utility { name: "uniq", source: Source::Own },
    Utility { name: "wc", source: Source::Own },
];

/// The registration table is the single source for command names and provenance.
#[must_use]
pub fn catalog() -> &'static [Utility] {
    UTILITIES
}

/// Run a registered utility over a VFS and pipeline input.
///
/// # Errors
/// Returns a shell-displayable error for invalid arguments or VFS failures.
pub fn run(
    name: &str,
    vfs: &mut dyn Vfs,
    cwd: &[u8],
    args: &[String],
    stdin: &[u8],
) -> Result<Vec<u8>, String> {
    let result = match name {
        "basename" => basename(args)?,
        "cat" => cat(vfs, cwd, args, stdin)?,
        "cut" => cut(vfs, cwd, args, stdin)?,
        "dirname" => dirname(args)?,
        "echo" => echo(args),
        "false" => return Err("false".into()),
        "head" => head_tail(vfs, cwd, args, stdin, true)?,
        "printf" => printf(args)?,
        "seq" => seq(args)?,
        "sort" => sort(vfs, cwd, args, stdin)?,
        "tail" => head_tail(vfs, cwd, args, stdin, false)?,
        "tee" => tee(vfs, cwd, args, stdin)?,
        "tr" => tr(args, stdin)?,
        "true" => Vec::new(),
        "uniq" => uniq(vfs, cwd, args, stdin)?,
        "wc" => wc(vfs, cwd, args, stdin)?,
        _ => return Err(format!("{name}: command not found")),
    };
    Ok(result)
}

fn resolve(cwd: &[u8], input: &str) -> Result<Vec<u8>, String> {
    path::resolve(cwd, input.as_bytes()).map_err(|e| e.to_string())
}

fn input(
    vfs: &mut dyn Vfs,
    cwd: &[u8],
    file: Option<&str>,
    stdin: &[u8],
) -> Result<Vec<u8>, String> {
    match file {
        None | Some("-") => Ok(stdin.to_vec()),
        Some(file) => vfs.read(&resolve(cwd, file)?).map_err(|e| format!("{file}: {e}")),
    }
}

fn cat(vfs: &mut dyn Vfs, cwd: &[u8], args: &[String], stdin: &[u8]) -> Result<Vec<u8>, String> {
    if args.is_empty() {
        return Ok(stdin.to_vec());
    }
    let mut out = Vec::new();
    for file in args {
        out.extend(input(vfs, cwd, Some(file), stdin)?);
    }
    Ok(out)
}

fn echo(args: &[String]) -> Vec<u8> {
    let (newline, rest) =
        if args.first().is_some_and(|a| a == "-n") { (false, &args[1..]) } else { (true, args) };
    let mut out = rest.join(" ").into_bytes();
    if newline {
        out.push(b'\n');
    }
    out
}

fn basename(args: &[String]) -> Result<Vec<u8>, String> {
    let name = args.first().ok_or("basename: missing operand")?;
    let trimmed = name.trim_end_matches('/');
    let part = if trimmed.is_empty() { "/" } else { trimmed.rsplit('/').next().unwrap_or(trimmed) };
    let suffix = args.get(1).map(String::as_str).unwrap_or("");
    let part = if !suffix.is_empty() && part != suffix {
        part.strip_suffix(suffix).unwrap_or(part)
    } else {
        part
    };
    Ok(format!("{part}\n").into_bytes())
}

fn dirname(args: &[String]) -> Result<Vec<u8>, String> {
    let name = args.first().ok_or("dirname: missing operand")?;
    let trimmed = name.trim_end_matches('/');
    if trimmed.is_empty() {
        return Ok(b"/\n".to_vec());
    }
    let parent = trimmed
        .rsplit_once('/')
        .map_or(".", |(parent, _)| if parent.is_empty() { "/" } else { parent });
    Ok(format!("{parent}\n").into_bytes())
}

fn lines(data: &[u8]) -> Vec<&[u8]> {
    data.split_inclusive(|&byte| byte == b'\n').collect()
}

fn head_tail(
    vfs: &mut dyn Vfs,
    cwd: &[u8],
    args: &[String],
    stdin: &[u8],
    head: bool,
) -> Result<Vec<u8>, String> {
    let mut count = 10usize;
    let mut bytes = false;
    let mut file = None;
    let mut at = 0;
    while at < args.len() {
        match args[at].as_str() {
            "-n" | "-c" => {
                bytes = args[at] == "-c";
                at += 1;
                count =
                    args.get(at).ok_or("missing count")?.parse().map_err(|_| "invalid count")?;
            },
            arg if arg.starts_with("-n") && arg.len() > 2 => {
                count = arg[2..].parse().map_err(|_| "invalid count")?
            },
            arg if arg.starts_with("-c") && arg.len() > 2 => {
                bytes = true;
                count = arg[2..].parse().map_err(|_| "invalid count")?;
            },
            arg if arg.starts_with('-') && arg != "-" => {
                return Err(format!("unknown option: {arg}"));
            },
            arg => {
                if file.replace(arg).is_some() {
                    return Err("too many files".into());
                }
            },
        }
        at += 1;
    }
    let data = input(vfs, cwd, file, stdin)?;
    if bytes {
        let len = data.len();
        return Ok(if head {
            data[..len.min(count)].to_vec()
        } else {
            data[len.saturating_sub(count)..].to_vec()
        });
    }
    let parts = lines(&data);
    let selected = if head {
        &parts[..parts.len().min(count)]
    } else {
        &parts[parts.len().saturating_sub(count)..]
    };
    Ok(selected.concat())
}

fn wc(vfs: &mut dyn Vfs, cwd: &[u8], args: &[String], stdin: &[u8]) -> Result<Vec<u8>, String> {
    let mut flags = Vec::new();
    let mut file = None;
    for arg in args {
        if arg.starts_with('-') && arg != "-" {
            for flag in arg[1..].chars() {
                if !matches!(flag, 'l' | 'w' | 'c' | 'm') {
                    return Err(format!("invalid option: {flag}"));
                }
                flags.push(flag);
            }
        } else if file.replace(arg.as_str()).is_some() {
            return Err("too many files".into());
        }
    }
    let data = input(vfs, cwd, file, stdin)?;
    let count = |flag| match flag {
        'l' => data.iter().filter(|&&b| b == b'\n').count(),
        'w' => String::from_utf8_lossy(&data).split_whitespace().count(),
        'm' => String::from_utf8_lossy(&data).chars().count(),
        _ => data.len(),
    };
    if flags.is_empty() {
        flags.extend(['l', 'w', 'c']);
    }
    let counts = flags.iter().map(|&flag| count(flag).to_string()).collect::<Vec<_>>().join(" ");
    Ok(format!("{counts}{}\n", file.map_or(String::new(), |name| format!(" {name}"))).into_bytes())
}

fn sort(vfs: &mut dyn Vfs, cwd: &[u8], args: &[String], stdin: &[u8]) -> Result<Vec<u8>, String> {
    let mut reverse = false;
    let mut unique = false;
    let mut file = None;
    for arg in args {
        match arg.as_str() {
            "-r" => reverse = true,
            "-u" => unique = true,
            arg if arg.starts_with('-') && arg != "-" => {
                return Err(format!("unknown option: {arg}"));
            },
            arg => {
                if file.replace(arg).is_some() {
                    return Err("too many files".into());
                }
            },
        }
    }
    let data = input(vfs, cwd, file, stdin)?;
    let mut parts = lines(&data);
    parts.sort_unstable();
    if unique {
        parts.dedup();
    }
    if reverse {
        parts.reverse();
    }
    Ok(parts.concat())
}

fn uniq(vfs: &mut dyn Vfs, cwd: &[u8], args: &[String], stdin: &[u8]) -> Result<Vec<u8>, String> {
    let mut count = false;
    let mut repeated = false;
    let mut unique = false;
    let mut file = None;
    for arg in args {
        match arg.as_str() {
            "-c" => count = true,
            "-d" => repeated = true,
            "-u" => unique = true,
            arg if arg.starts_with('-') && arg != "-" => {
                return Err(format!("unknown option: {arg}"));
            },
            arg => {
                if file.replace(arg).is_some() {
                    return Err("too many files".into());
                }
            },
        }
    }
    let data = input(vfs, cwd, file, stdin)?;
    let parts = lines(&data);
    let mut out = Vec::new();
    let mut at = 0;
    while at < parts.len() {
        let mut end = at + 1;
        while end < parts.len() && parts[end] == parts[at] {
            end += 1;
        }
        if (!repeated || end - at > 1) && (!unique || end - at == 1) {
            if count {
                out.extend(format!("{:>7} ", end - at).as_bytes());
            }
            out.extend_from_slice(parts[at]);
        }
        at = end;
    }
    Ok(out)
}

fn tee(vfs: &mut dyn Vfs, cwd: &[u8], args: &[String], stdin: &[u8]) -> Result<Vec<u8>, String> {
    let append = args.first().is_some_and(|arg| arg == "-a");
    let files = if append { &args[1..] } else { args };
    for file in files {
        let path = resolve(cwd, file)?;
        if append { vfs.append(&path, stdin) } else { vfs.write(&path, stdin) }
            .map_err(|e| format!("{file}: {e}"))?;
    }
    Ok(stdin.to_vec())
}

fn cut(vfs: &mut dyn Vfs, cwd: &[u8], args: &[String], stdin: &[u8]) -> Result<Vec<u8>, String> {
    let mut delimiter = b'\t';
    let mut field = None;
    let mut byte = None;
    let mut file = None;
    let mut at = 0;
    while at < args.len() {
        match args[at].as_str() {
            "-d" | "-f" | "-b" => {
                let flag = args[at].as_str();
                at += 1;
                let value = args.get(at).ok_or("missing option value")?;
                match flag {
                    "-d" => {
                        let b = value.as_bytes();
                        if b.len() != 1 {
                            return Err("delimiter must be one byte".into());
                        }
                        delimiter = b[0];
                    },
                    "-f" => field = Some(value.parse::<usize>().map_err(|_| "invalid field")?),
                    _ => byte = Some(value.parse::<usize>().map_err(|_| "invalid byte")?),
                }
            },
            arg if arg.starts_with('-') && arg != "-" => {
                return Err(format!("unknown option: {arg}"));
            },
            arg => {
                if file.replace(arg).is_some() {
                    return Err("too many files".into());
                }
            },
        }
        at += 1;
    }
    if field.is_none() == byte.is_none() {
        return Err("choose exactly one of -f or -b".into());
    }
    if field == Some(0) || byte == Some(0) {
        return Err("positions start at 1".into());
    }
    let data = input(vfs, cwd, file, stdin)?;
    let mut out = Vec::new();
    for line in lines(&data) {
        let (body, newline) = line.strip_suffix(b"\n").map_or((line, false), |body| (body, true));
        if let Some(position) = field {
            let parts = body.split(|&b| b == delimiter).collect::<Vec<_>>();
            if parts.len() == 1 {
                out.extend_from_slice(body);
            } else if let Some(part) = parts.get(position - 1) {
                out.extend_from_slice(part);
            }
        } else if let Some(position) = byte
            && let Some(&value) = body.get(position - 1)
        {
            out.push(value);
        }
        if newline {
            out.push(b'\n');
        }
    }
    Ok(out)
}

fn tr(args: &[String], stdin: &[u8]) -> Result<Vec<u8>, String> {
    let (delete, sets) = if args.first().is_some_and(|arg| arg == "-d") {
        (true, &args[1..])
    } else {
        (false, args)
    };
    if sets.is_empty() || (!delete && sets.len() != 2) || (delete && sets.len() != 1) {
        return Err("usage: tr [-d] SET1 [SET2]".into());
    }
    let from = expand_ascii_ranges(sets[0].as_bytes())?;
    let to = expand_ascii_ranges(sets.get(1).map(String::as_bytes).unwrap_or(b""))?;
    if !delete && to.is_empty() {
        return Err("replacement set is empty".into());
    }
    Ok(stdin
        .iter()
        .filter_map(|&byte| {
            let index = from.iter().position(|&candidate| candidate == byte);
            if delete && index.is_some() {
                None
            } else {
                Some(
                    index
                        .and_then(|index| to.get(index).or_else(|| to.last()))
                        .copied()
                        .unwrap_or(byte),
                )
            }
        })
        .collect())
}

fn expand_ascii_ranges(set: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut at = 0;
    while at < set.len() {
        if at + 2 < set.len() && set[at + 1] == b'-' {
            let (first, last) = (set[at], set[at + 2]);
            if !first.is_ascii() || !last.is_ascii() || first > last {
                return Err("invalid character range".into());
            }
            out.extend(first..=last);
            at += 3;
        } else {
            out.push(set[at]);
            at += 1;
        }
    }
    Ok(out)
}

fn printf(args: &[String]) -> Result<Vec<u8>, String> {
    let format = args.first().ok_or("printf: missing format")?;
    let mut out = String::new();
    let mut values = args[1..].iter();
    let mut chars = format.chars();
    while let Some(ch) = chars.next() {
        match ch {
            '%' => match chars.next() {
                Some('%') => out.push('%'),
                Some('s') | Some('b') => {
                    out.push_str(values.next().map(String::as_str).unwrap_or(""))
                },
                Some('d') => {
                    let value = values.next().map(String::as_str).unwrap_or("0");
                    out.push_str(&value.parse::<i64>().map_err(|_| "invalid integer")?.to_string());
                },
                _ => return Err("unsupported format".into()),
            },
            '\\' => match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some(other) => out.push(other),
                None => out.push('\\'),
            },
            other => out.push(other),
        }
    }
    Ok(out.into_bytes())
}

fn seq(args: &[String]) -> Result<Vec<u8>, String> {
    let values = args
        .iter()
        .map(|s| s.parse::<i64>().map_err(|_| "invalid integer"))
        .collect::<Result<Vec<_>, _>>()?;
    let (first, step, last) = match values.as_slice() {
        [last] => (1, 1, *last),
        [first, last] => (*first, 1, *last),
        [first, step, last] => (*first, *step, *last),
        _ => return Err("usage: seq [FIRST [STEP]] LAST".into()),
    };
    if step == 0 {
        return Err("step cannot be zero".into());
    }
    let mut out = Vec::new();
    let mut current = first;
    for _ in 0..1_000_000 {
        if (step > 0 && current > last) || (step < 0 && current < last) {
            return Ok(out);
        }
        out.extend(format!("{current}\n").as_bytes());
        if current == last {
            return Ok(out);
        }
        current = current.checked_add(step).ok_or("sequence overflow")?;
    }
    Err("sequence exceeds one million values".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use aphrody_shell_vfs::MemVfs;

    fn run_test(name: &str, args: &[&str], stdin: &[u8]) -> Vec<u8> {
        let mut fs = MemVfs::new();
        run(name, &mut fs, b"/", &args.iter().map(|s| (*s).into()).collect::<Vec<_>>(), stdin)
            .unwrap()
    }

    #[test]
    fn registry_lists_every_implemented_command() {
        for command in catalog() {
            assert!(command.source == Source::Own);
            assert_ne!(
                run(command.name, &mut MemVfs::new(), b"/", &[], b""),
                Err(format!("{}: command not found", command.name))
            );
        }
    }

    #[test]
    fn pipe_filters_and_counts() {
        let data = b"pear\napple\npear\n";
        assert_eq!(run_test("sort", &[], data), b"apple\npear\npear\n");
        assert_eq!(run_test("uniq", &[], b"a\na\nb\n"), b"a\nb\n");
        assert_eq!(run_test("head", &["-n", "2"], data), b"pear\napple\n");
        assert_eq!(run_test("tail", &["-n", "1"], data), b"pear\n");
        assert_eq!(run_test("wc", &["-l"], data), b"3\n");
        assert_eq!(run_test("cut", &["-d", ":", "-f", "2"], b"a:one\nb:two\n"), b"one\ntwo\n");
        assert_eq!(run_test("tr", &["ab", "xy"], b"abba\n"), b"xyyx\n");
        assert_eq!(run_test("tr", &["a-z", "A-Z"], b"hi!\n"), b"HI!\n");
    }

    #[test]
    fn vfs_read_write_and_pipeline_bytes() {
        let mut fs = MemVfs::new();
        fs.mkdir(b"/sub").unwrap();
        let args = |values: &[&str]| values.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
        assert_eq!(run("tee", &mut fs, b"/sub", &args(&["file"]), b"first\n").unwrap(), b"first\n");
        assert_eq!(run("cat", &mut fs, b"/sub", &args(&["file"]), b"").unwrap(), b"first\n");
        run("tee", &mut fs, b"/sub", &args(&["-a", "file"]), b"second\n").unwrap();
        assert_eq!(fs.read(b"/sub/file").unwrap(), b"first\nsecond\n");
    }

    #[test]
    fn format_paths_and_sequence() {
        assert_eq!(run_test("basename", &["/a/b.txt", ".txt"], b""), b"b\n");
        assert_eq!(run_test("dirname", &["/a/b.txt"], b""), b"/a\n");
        assert_eq!(run_test("dirname", &["/"], b""), b"/\n");
        assert_eq!(run_test("printf", &["%s:%d\\n", "age", "42"], b""), b"age:42\n");
        assert_eq!(run_test("seq", &["3"], b""), b"1\n2\n3\n");
        assert_eq!(run_test("echo", &["-n", "hello"], b""), b"hello");
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn golden_output_matches_pinned_native_uutils_when_available() {
        use std::{
            io::Write,
            process::{Command, Stdio},
        };

        let Ok(binary) = std::env::var("APHRODY_COREUTILS_BIN") else {
            return;
        };
        let cases: &[(&str, &[&str], &[u8])] = &[
            ("basename", &["/a/b.txt", ".txt"], b""),
            ("cat", &[], b"one\ntwo\n"),
            ("cut", &["-d", ":", "-f", "2"], b"a:one\nb:two\n"),
            ("dirname", &["/a/b.txt"], b""),
            ("echo", &["-n", "hello"], b""),
            ("head", &["-n", "2"], b"one\ntwo\nthree\n"),
            ("printf", &["%s:%d\\n", "age", "42"], b""),
            ("seq", &["3"], b""),
            ("sort", &[], b"pear\napple\npear\n"),
            ("tail", &["-n", "1"], b"one\ntwo\nthree\n"),
            ("tee", &[], b"one\ntwo\n"),
            ("tr", &["a-z", "A-Z"], b"hi!\n"),
            ("uniq", &[], b"a\na\nb\n"),
            ("wc", &["-l"], b"one\ntwo\nthree\n"),
        ];
        for &(name, args, stdin) in cases {
            let mut child = Command::new(&binary)
                .arg(name)
                .args(args)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .unwrap();
            child.stdin.take().unwrap().write_all(stdin).unwrap();
            let native = child.wait_with_output().unwrap();
            assert!(native.status.success(), "{name}: {}", String::from_utf8_lossy(&native.stderr));
            assert_eq!(run_test(name, args, stdin), native.stdout, "{name}");
        }
    }
}
