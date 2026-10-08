// SPDX-License-Identifier: Apache-2.0
//! In-process POSIX builtins matching `bun_runtime::shell::builtin`.
//!
//! Executes standard shell utilities in-process without fork/exec:
//! `echo`, `cat`, `ls`, `cd`, `pwd`, `mkdir`, `rm`, `touch`, `which`,
//! `true`, `false`, `seq`, `basename`, `dirname`.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Execution context for in-process builtins.
pub struct BuiltinContext<'a> {
    /// Command arguments (`argv[0]` is command name).
    pub argv: &'a [String],
    /// Stdin bytes.
    pub stdin: &'a [u8],
    /// Output stdout buffer.
    pub stdout: &'a mut Vec<u8>,
    /// Output stderr buffer.
    pub stderr: &'a mut Vec<u8>,
    /// Current working directory mutable reference.
    pub cwd: &'a mut PathBuf,
}

/// Check if a command name is a supported in-process builtin.
pub fn is_builtin(cmd: &str) -> bool {
    matches!(
        cmd,
        "echo"
            | "cat"
            | "ls"
            | "cd"
            | "pwd"
            | "mkdir"
            | "rm"
            | "touch"
            | "which"
            | "true"
            | "false"
            | "seq"
            | "basename"
            | "dirname"
    )
}

/// Execute a builtin command in-process. Returns exit code (0 for success).
pub fn run_builtin(cmd: &str, cx: BuiltinContext<'_>) -> i32 {
    match cmd {
        "echo" => builtin_echo(cx.argv, cx.stdout),
        "cat" => builtin_cat(cx.argv, cx.stdin, cx.stdout, cx.stderr, cx.cwd),
        "ls" => builtin_ls(cx.argv, cx.stdout, cx.stderr, cx.cwd),
        "cd" => builtin_cd(cx.argv, cx.stderr, cx.cwd),
        "pwd" => builtin_pwd(cx.stdout, cx.cwd),
        "mkdir" => builtin_mkdir(cx.argv, cx.stderr, cx.cwd),
        "rm" => builtin_rm(cx.argv, cx.stderr, cx.cwd),
        "touch" => builtin_touch(cx.argv, cx.stderr, cx.cwd),
        "which" => builtin_which(cx.argv, cx.stdout, cx.stderr),
        "true" => 0,
        "false" => 1,
        "seq" => builtin_seq(cx.argv, cx.stdout, cx.stderr),
        "basename" => builtin_basename(cx.argv, cx.stdout, cx.stderr),
        "dirname" => builtin_dirname(cx.argv, cx.stdout, cx.stderr),
        _ => {
            let msg = format!("{}: builtin not found\n", cmd);
            cx.stderr.extend_from_slice(msg.as_bytes());
            127
        }
    }
}

// ─── echo ────────────────────────────────────────────────────────────────────
fn builtin_echo(argv: &[String], stdout: &mut Vec<u8>) -> i32 {
    let mut no_newline = false;
    let mut enable_escapes = false;
    let mut args_start = 1;

    // Parse options: -n, -e, -E
    while args_start < argv.len() {
        let arg = &argv[args_start];
        if arg.starts_with('-') && arg.len() > 1 && arg[1..].chars().all(|c| matches!(c, 'n' | 'e' | 'E')) {
            for c in arg[1..].chars() {
                match c {
                    'n' => no_newline = true,
                    'e' => enable_escapes = true,
                    'E' => enable_escapes = false,
                    _ => {}
                }
            }
            args_start += 1;
        } else {
            break;
        }
    }

    let items = &argv[args_start..];
    for (i, item) in items.iter().enumerate() {
        if i > 0 {
            stdout.push(b' ');
        }
        if enable_escapes {
            append_escaped(stdout, item);
        } else {
            stdout.extend_from_slice(item.as_bytes());
        }
    }

    if !no_newline {
        stdout.push(b'\n');
    }

    0
}

fn append_escaped(buf: &mut Vec<u8>, s: &str) {
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('a') => buf.push(0x07),
                Some('b') => buf.push(0x08),
                Some('e') | Some('E') => buf.push(0x1B),
                Some('f') => buf.push(0x0C),
                Some('n') => buf.push(b'\n'),
                Some('r') => buf.push(b'\r'),
                Some('t') => buf.push(b'\t'),
                Some('v') => buf.push(0x0B),
                Some('\\') => buf.push(b'\\'),
                Some('0') => {
                    // Octal escape \0NNN
                    let mut oct = 0u8;
                    for _ in 0..3 {
                        if let Some(&d) = chars.peek() {
                            if ('0'..='7').contains(&d) {
                                oct = (oct << 3) | (d as u8 - b'0');
                                chars.next();
                            } else {
                                break;
                            }
                        }
                    }
                    buf.push(oct);
                }
                Some('x') => {
                    // Hex escape \xHH
                    let mut hex_val = 0u8;
                    let mut count = 0;
                    for _ in 0..2 {
                        if let Some(&d) = chars.peek() {
                            if let Some(digit) = d.to_digit(16) {
                                hex_val = (hex_val << 4) | (digit as u8);
                                chars.next();
                                count += 1;
                            } else {
                                break;
                            }
                        }
                    }
                    if count > 0 {
                        buf.push(hex_val);
                    } else {
                        buf.extend_from_slice(b"\\x");
                    }
                }
                Some(other) => {
                    buf.push(b'\\');
                    let mut b = [0u8; 4];
                    buf.extend_from_slice(other.encode_utf8(&mut b).as_bytes());
                }
                None => buf.push(b'\\'),
            }
        } else {
            let mut b = [0u8; 4];
            buf.extend_from_slice(c.encode_utf8(&mut b).as_bytes());
        }
    }
}

// ─── cat ─────────────────────────────────────────────────────────────────────
fn builtin_cat(
    argv: &[String],
    stdin: &[u8],
    stdout: &mut Vec<u8>,
    stderr: &mut Vec<u8>,
    cwd: &Path,
) -> i32 {
    let files = &argv[1..];
    if files.is_empty() {
        stdout.extend_from_slice(stdin);
        return 0;
    }

    let mut exit_code = 0;
    for file in files {
        if file == "-" {
            stdout.extend_from_slice(stdin);
            continue;
        }

        let p = cwd.join(file);
        match fs::File::open(&p) {
            Ok(mut f) => {
                let mut chunk = vec![0u8; 64 * 1024];
                loop {
                    match f.read(&mut chunk) {
                        Ok(0) => break,
                        Ok(n) => stdout.extend_from_slice(&chunk[..n]),
                        Err(e) => {
                            let msg = format!("cat: {}: {}\n", file, e);
                            stderr.extend_from_slice(msg.as_bytes());
                            exit_code = 1;
                            break;
                        }
                    }
                }
            }
            Err(e) => {
                let msg = format!("cat: {}: {}\n", file, e);
                stderr.extend_from_slice(msg.as_bytes());
                exit_code = 1;
            }
        }
    }

    exit_code
}

// ─── ls ──────────────────────────────────────────────────────────────────────
fn builtin_ls(
    argv: &[String],
    stdout: &mut Vec<u8>,
    stderr: &mut Vec<u8>,
    cwd: &Path,
) -> i32 {
    let mut show_all = false;
    let mut long_format = false;
    let mut targets = Vec::new();

    for arg in &argv[1..] {
        if arg.starts_with('-') && arg.len() > 1 && !arg.starts_with("--") {
            for c in arg[1..].chars() {
                match c {
                    'a' | 'A' => show_all = true,
                    'l' => long_format = true,
                    _ => {}
                }
            }
        } else {
            targets.push(arg.as_str());
        }
    }

    if targets.is_empty() {
        targets.push(".");
    }

    let mut exit_code = 0;
    for (idx, target) in targets.iter().enumerate() {
        if targets.len() > 1 {
            if idx > 0 {
                stdout.push(b'\n');
            }
            let header = format!("{}:\n", target);
            stdout.extend_from_slice(header.as_bytes());
        }

        let p = cwd.join(target);
        match fs::read_dir(&p) {
            Ok(entries) => {
                let mut names: Vec<(String, bool, u64)> = Vec::new();
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if !show_all && name.starts_with('.') {
                        continue;
                    }
                    let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                    let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                    names.push((name, is_dir, size));
                }
                names.sort_by(|a, b| a.0.cmp(&b.0));

                for (name, is_dir, size) in names {
                    if long_format {
                        let kind = if is_dir { "d" } else { "-" };
                        let line = format!("{} {:>10} {}\n", kind, size, name);
                        stdout.extend_from_slice(line.as_bytes());
                    } else {
                        stdout.extend_from_slice(name.as_bytes());
                        stdout.push(b'\n');
                    }
                }
            }
            Err(e) => {
                let msg = format!("ls: {}: {}\n", target, e);
                stderr.extend_from_slice(msg.as_bytes());
                exit_code = 1;
            }
        }
    }

    exit_code
}

// ─── cd ──────────────────────────────────────────────────────────────────────
fn builtin_cd(argv: &[String], stderr: &mut Vec<u8>, cwd: &mut PathBuf) -> i32 {
    let target = match argv.get(1) {
        Some(t) if t == "~" => {
            match std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
                Some(h) => PathBuf::from(h),
                None => cwd.clone(),
            }
        }
        Some(t) => cwd.join(t),
        None => {
            match std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
                Some(h) => PathBuf::from(h),
                None => cwd.clone(),
            }
        }
    };

    match fs::canonicalize(&target) {
        Ok(canon) if canon.is_dir() => {
            *cwd = canon;
            0
        }
        Ok(_) => {
            let msg = format!("cd: {}: Not a directory\n", target.display());
            stderr.extend_from_slice(msg.as_bytes());
            1
        }
        Err(e) => {
            let msg = format!("cd: {}: {}\n", target.display(), e);
            stderr.extend_from_slice(msg.as_bytes());
            1
        }
    }
}

// ─── pwd ─────────────────────────────────────────────────────────────────────
fn builtin_pwd(stdout: &mut Vec<u8>, cwd: &Path) -> i32 {
    let s = cwd.display().to_string();
    stdout.extend_from_slice(s.as_bytes());
    stdout.push(b'\n');
    0
}

// ─── mkdir ───────────────────────────────────────────────────────────────────
fn builtin_mkdir(argv: &[String], stderr: &mut Vec<u8>, cwd: &Path) -> i32 {
    let mut parents = false;
    let mut targets = Vec::new();

    for arg in &argv[1..] {
        if arg == "-p" || arg == "--parents" {
            parents = true;
        } else {
            targets.push(arg.as_str());
        }
    }

    if targets.is_empty() {
        stderr.extend_from_slice(b"mkdir: missing operand\n");
        return 1;
    }

    let mut exit_code = 0;
    for target in targets {
        let p = cwd.join(target);
        let res = if parents {
            fs::create_dir_all(&p)
        } else {
            fs::create_dir(&p)
        };
        if let Err(e) = res {
            let msg = format!("mkdir: cannot create directory '{}': {}\n", target, e);
            stderr.extend_from_slice(msg.as_bytes());
            exit_code = 1;
        }
    }

    exit_code
}

// ─── rm ──────────────────────────────────────────────────────────────────────
fn builtin_rm(argv: &[String], stderr: &mut Vec<u8>, cwd: &Path) -> i32 {
    let mut recursive = false;
    let mut force = false;
    let mut targets = Vec::new();

    for arg in &argv[1..] {
        if arg.starts_with('-') && !arg.starts_with("--") {
            for c in arg[1..].chars() {
                match c {
                    'r' | 'R' => recursive = true,
                    'f' => force = true,
                    _ => {}
                }
            }
        } else if arg == "--recursive" {
            recursive = true;
        } else if arg == "--force" {
            force = true;
        } else {
            targets.push(arg.as_str());
        }
    }

    let mut exit_code = 0;
    for target in targets {
        let p = cwd.join(target);
        if !p.exists() {
            if !force {
                let msg = format!("rm: cannot remove '{}': No such file or directory\n", target);
                stderr.extend_from_slice(msg.as_bytes());
                exit_code = 1;
            }
            continue;
        }

        let res = if p.is_dir() {
            if recursive {
                fs::remove_dir_all(&p)
            } else {
                let msg = format!("rm: cannot remove '{}': Is a directory\n", target);
                stderr.extend_from_slice(msg.as_bytes());
                exit_code = 1;
                continue;
            }
        } else {
            fs::remove_file(&p)
        };

        if let Err(e) = res {
            if !force {
                let msg = format!("rm: cannot remove '{}': {}\n", target, e);
                stderr.extend_from_slice(msg.as_bytes());
                exit_code = 1;
            }
        }
    }

    exit_code
}

// ─── touch ───────────────────────────────────────────────────────────────────
fn builtin_touch(argv: &[String], stderr: &mut Vec<u8>, cwd: &Path) -> i32 {
    let targets = &argv[1..];
    if targets.is_empty() {
        stderr.extend_from_slice(b"touch: missing file operand\n");
        return 1;
    }

    let mut exit_code = 0;
    for target in targets {
        let p = cwd.join(target);
        if p.exists() {
            // Touch existing file
            let _ = fs::OpenOptions::new().write(true).open(&p);
        } else {
            // Create empty file
            if let Err(e) = fs::File::create(&p) {
                let msg = format!("touch: cannot touch '{}': {}\n", target, e);
                stderr.extend_from_slice(msg.as_bytes());
                exit_code = 1;
            }
        }
    }

    exit_code
}

// ─── which ───────────────────────────────────────────────────────────────────
fn builtin_which(argv: &[String], stdout: &mut Vec<u8>, stderr: &mut Vec<u8>) -> i32 {
    let targets = &argv[1..];
    if targets.is_empty() {
        stderr.extend_from_slice(b"which: missing operand\n");
        return 1;
    }

    let mut exit_code = 0;
    for target in targets {
        match which::which(target) {
            Ok(p) => {
                stdout.extend_from_slice(p.display().to_string().as_bytes());
                stdout.push(b'\n');
            }
            Err(_) => {
                let msg = format!("{}: not found\n", target);
                stderr.extend_from_slice(msg.as_bytes());
                exit_code = 1;
            }
        }
    }

    exit_code
}

// ─── seq ─────────────────────────────────────────────────────────────────────
fn builtin_seq(argv: &[String], stdout: &mut Vec<u8>, stderr: &mut Vec<u8>) -> i32 {
    let args = &argv[1..];
    let (first, step, last) = match args.len() {
        1 => (Ok(1isize), Ok(1isize), args[0].parse::<isize>()),
        2 => (args[0].parse::<isize>(), Ok(1isize), args[1].parse::<isize>()),
        3 => (
            args[0].parse::<isize>(),
            args[1].parse::<isize>(),
            args[2].parse::<isize>(),
        ),
        _ => {
            stderr.extend_from_slice(b"seq: invalid arguments (usage: seq [FIRST [STEP]] LAST)\n");
            return 1;
        }
    };

    let (f, s, l) = match (first, step, last) {
        (Ok(f), Ok(s), Ok(l)) if s != 0 => (f, s, l),
        _ => {
            stderr.extend_from_slice(b"seq: invalid integer format\n");
            return 1;
        }
    };

    if s > 0 {
        let mut curr = f;
        while curr <= l {
            let line = format!("{}\n", curr);
            stdout.extend_from_slice(line.as_bytes());
            curr += s;
        }
    } else {
        let mut curr = f;
        while curr >= l {
            let line = format!("{}\n", curr);
            stdout.extend_from_slice(line.as_bytes());
            curr += s;
        }
    }

    0
}

// ─── basename ────────────────────────────────────────────────────────────────
fn builtin_basename(argv: &[String], stdout: &mut Vec<u8>, stderr: &mut Vec<u8>) -> i32 {
    let args = &argv[1..];
    if args.is_empty() {
        stderr.extend_from_slice(b"basename: missing operand\n");
        return 1;
    }

    let path = Path::new(&args[0]);
    let name = path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default();
    let suffix = args.get(1);

    let result = if let Some(suff) = suffix {
        name.strip_suffix(suff).unwrap_or(&name)
    } else {
        &name
    };

    stdout.extend_from_slice(result.as_bytes());
    stdout.push(b'\n');
    0
}

// ─── dirname ─────────────────────────────────────────────────────────────────
fn builtin_dirname(argv: &[String], stdout: &mut Vec<u8>, stderr: &mut Vec<u8>) -> i32 {
    let args = &argv[1..];
    if args.is_empty() {
        stderr.extend_from_slice(b"dirname: missing operand\n");
        return 1;
    }

    let path = Path::new(&args[0]);
    let dir = path.parent().map(|p| p.display().to_string()).unwrap_or_else(|| ".".to_string());
    let dir = if dir.is_empty() { ".".to_string() } else { dir };

    stdout.extend_from_slice(dir.as_bytes());
    stdout.push(b'\n');
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_echo_escapes() {
        let mut stdout = Vec::new();
        let argv = vec!["echo".to_string(), "-e".to_string(), "hello\\nworld".to_string()];
        let code = builtin_echo(&argv, &mut stdout);
        assert_eq!(code, 0);
        assert_eq!(String::from_utf8(stdout).unwrap(), "hello\nworld\n");
    }

    #[test]
    fn test_seq() {
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let argv = vec!["seq".to_string(), "1".to_string(), "2".to_string(), "5".to_string()];
        let code = builtin_seq(&argv, &mut stdout, &mut stderr);
        assert_eq!(code, 0);
        assert_eq!(String::from_utf8(stdout).unwrap(), "1\n3\n5\n");
    }
}
