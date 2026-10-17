// SPDX-License-Identifier: Apache-2.0
//! Execute shell operators over raw byte streams and the VFS.

use super::{FileKind, LocalShell};
use crate::syntax::{Atom, Token, Word, tokenize};

/// Evaluate a command line. Command failures set a false status for `&&`/`||`
/// and contribute diagnostics to the output stream.
pub(super) fn run(shell: &mut LocalShell, line: &str) -> Result<Vec<u8>, String> {
    let tokens = tokenize(line)?;
    if tokens.is_empty() {
        return Ok(Vec::new());
    }
    let mut output = Vec::new();
    let mut start = 0;
    let mut previous = None;
    let mut succeeded = true;
    for end in 0..=tokens.len() {
        if end != tokens.len() && !matches!(tokens[end], Token::And | Token::Or) {
            continue;
        }
        if start == end {
            return Err("empty conditional command".into());
        }
        let should_run = match previous {
            Some(Token::And) => succeeded,
            Some(Token::Or) => !succeeded,
            _ => true,
        };
        if should_run {
            match pipeline(shell, &tokens[start..end]) {
                Ok(bytes) => {
                    output.extend(bytes);
                    succeeded = true;
                }
                Err(error) => {
                    output.extend_from_slice(format!("{error}\n").as_bytes());
                    succeeded = false;
                }
            }
        }
        previous = tokens.get(end).cloned();
        start = end + 1;
    }
    Ok(output)
}

fn pipeline(shell: &mut LocalShell, tokens: &[Token]) -> Result<Vec<u8>, String> {
    let mut input = Vec::new();
    let mut start = 0;
    for end in 0..=tokens.len() {
        if end != tokens.len() && tokens[end] != Token::Pipe {
            continue;
        }
        if start == end {
            return Err("empty pipeline segment".into());
        }
        input = segment(shell, &tokens[start..end], &input)?;
        start = end + 1;
    }
    Ok(input)
}

fn segment(shell: &mut LocalShell, tokens: &[Token], stdin: &[u8]) -> Result<Vec<u8>, String> {
    let mut args = Vec::new();
    let mut input_file = None;
    let mut output_file = None;
    let mut i = 0;
    while i < tokens.len() {
        match &tokens[i] {
            Token::Word(word) => args.extend(expand_word(shell, word)),
            op @ (Token::Read | Token::Write | Token::Append) => {
                let Some(Token::Word(word)) = tokens.get(i + 1) else {
                    return Err("missing redirect path".into());
                };
                let targets = expand_word(shell, word);
                if targets.len() != 1 {
                    return Err("redirect requires exactly one path".into());
                }
                let target = targets.into_iter().next().unwrap();
                match op {
                    Token::Read => input_file = Some(target),
                    Token::Write => output_file = Some((target, false)),
                    Token::Append => output_file = Some((target, true)),
                    _ => unreachable!(),
                }
                i += 1;
            }
            _ => return Err("unexpected shell operator".into()),
        }
        i += 1;
    }
    if args.is_empty() {
        return Err("empty command".into());
    }
    let input = if let Some(name) = &input_file {
        shell
            .vfs
            .read(&shell.resolve(name)?)
            .map_err(|e| format!("{name}: {e}"))?
    } else {
        stdin.to_vec()
    };
    let mut output = command(shell, &args, &input)?;
    if let Some((name, append)) = output_file {
        let path = shell.resolve(&name)?;
        if append {
            shell.vfs.append(&path, &output)
        } else {
            shell.vfs.write(&path, &output)
        }
        .map_err(|e| format!("{name}: {e}"))?;
        output.clear();
    }
    Ok(output)
}

fn expand_word(shell: &mut LocalShell, word: &Word) -> Vec<String> {
    let mut chars = Vec::new();
    for atom in &word.0 {
        match atom {
            Atom::Literal(ch, eligible) => chars.push((*ch, *eligible)),
            Atom::Variable(name, eligible) => chars.extend(
                shell
                    .env
                    .get(name)
                    .map_or("", String::as_str)
                    .chars()
                    .map(|ch| (ch, *eligible)),
            ),
        }
    }
    let value: String = chars.iter().map(|(ch, _)| ch).collect();
    if !chars
        .iter()
        .any(|(ch, eligible)| *eligible && matches!(ch, '*' | '?'))
    {
        return vec![value];
    }
    let absolute = value.starts_with('/');
    let components: Vec<Vec<(char, bool)>> = chars
        .split(|(ch, _)| *ch == '/')
        .filter(|component| !component.is_empty())
        .map(<[(char, bool)]>::to_vec)
        .collect();
    let initial = if absolute {
        b"/".to_vec()
    } else {
        shell.cwd.clone()
    };
    let mut paths = vec![(
        initial,
        if absolute {
            "/".to_owned()
        } else {
            String::new()
        },
    )];
    for component in components {
        let wildcard = component
            .iter()
            .any(|(ch, eligible)| *eligible && matches!(ch, '*' | '?'));
        let literal: String = component.iter().map(|(ch, _)| ch).collect();
        let mut next = Vec::new();
        for (base, display) in paths {
            if wildcard {
                let Ok(entries) = shell.vfs.read_dir(&base) else {
                    continue;
                };
                for entry in entries {
                    let Ok(name) = std::str::from_utf8(&entry.name) else {
                        continue;
                    };
                    if name.starts_with('.') && component.first().map(|(ch, _)| *ch) != Some('.') {
                        continue;
                    }
                    if glob_matches(&component, name) {
                        next.push((
                            aphrody_shell_vfs::path::join(&base, &entry.name),
                            display_join(&display, name),
                        ));
                    }
                }
            } else {
                next.push((
                    aphrody_shell_vfs::path::join(&base, literal.as_bytes()),
                    display_join(&display, &literal),
                ));
            }
            if next.len() >= 1024 {
                break;
            }
        }
        paths = next;
        if paths.is_empty() {
            return vec![value];
        }
    }
    paths.into_iter().map(|(_, display)| display).collect()
}

fn display_join(base: &str, name: &str) -> String {
    if base.is_empty() {
        name.to_owned()
    } else if base == "/" {
        format!("/{name}")
    } else {
        format!("{base}/{name}")
    }
}

fn glob_matches(pattern: &[(char, bool)], name: &str) -> bool {
    let name: Vec<char> = name.chars().collect();
    let mut previous = vec![false; name.len() + 1];
    previous[0] = true;
    for (ch, eligible) in pattern {
        let mut current = vec![false; name.len() + 1];
        if *eligible && *ch == '*' {
            current[0] = previous[0];
            for i in 1..=name.len() {
                current[i] = previous[i] || current[i - 1];
            }
        } else {
            for i in 1..=name.len() {
                current[i] = previous[i - 1] && ((*eligible && *ch == '?') || *ch == name[i - 1]);
            }
        }
        previous = current;
    }
    previous[name.len()]
}

fn command(shell: &mut LocalShell, args: &[String], stdin: &[u8]) -> Result<Vec<u8>, String> {
    let name = args[0].as_str();
    if let Some(registered) = shell.commands.get(name).cloned() {
        return registered.run(shell, &args[1..], stdin);
    }
    let rest: Vec<&str> = args[1..].iter().map(String::as_str).collect();
    let text = match name {
        "help" => {
            let mut names = vec![
                "help", "clear", "env", "set", "history", "version", "exit", "cd", "pwd", "ls",
                "mkdir", "rm", "cp", "mv", "touch",
            ];
            names.extend(shell.commands.keys().map(String::as_str));
            names.sort_unstable();
            names.dedup();
            format!("commands: {}\n", names.join(" "))
        }
        "echo" => format!("{}\n", rest.join(" ")),
        "clear" => return Ok(b"\x1b[2J\x1b[H".to_vec()),
        "version" => format!("{}\n", env!("CARGO_PKG_VERSION")),
        "history" => shell
            .history
            .iter()
            .enumerate()
            .map(|(i, entry)| format!("{:>4}  {entry}\n", i + 1))
            .collect(),
        "set" => {
            let (&key, values) = rest.split_first().ok_or("usage: set NAME [VALUE...]")?;
            shell.env.insert(key.to_owned(), values.join(" "));
            String::new()
        }
        "env" => shell
            .env
            .iter()
            .map(|(k, v)| format!("{k}={v}\n"))
            .collect(),
        "pwd" => format!("{}\n", String::from_utf8_lossy(&shell.cwd)),
        "cd" => {
            let target = rest.first().copied().unwrap_or("/");
            let path = shell.resolve(target)?;
            let stat = shell
                .vfs
                .stat(&path)
                .map_err(|e| format!("cd: {target}: {e}"))?;
            if stat.kind != FileKind::Dir {
                return Err(format!("cd: {target}: not a directory"));
            }
            shell.cwd = path;
            String::new()
        }
        "ls" => {
            let target = rest.first().copied().unwrap_or(".");
            let path = shell.resolve(target)?;
            match shell
                .vfs
                .stat(&path)
                .map_err(|e| format!("ls: {target}: {e}"))?
                .kind
            {
                FileKind::File => format!("{target}\n"),
                FileKind::Dir => shell
                    .vfs
                    .read_dir(&path)
                    .map_err(|e| format!("ls: {target}: {e}"))?
                    .iter()
                    .map(|entry| format!("{}\n", String::from_utf8_lossy(&entry.name)))
                    .collect(),
            }
        }
        "cat" if rest.is_empty() => return Ok(stdin.to_vec()),
        "cat" | "mkdir" | "rm" | "touch" | "cp" | "mv" => {
            return shell
                .file_command(name, &rest)
                .map_err(|e| format!("{name}: {e}"));
        }
        "wc" => {
            let file = rest.iter().find(|arg| !arg.starts_with('-'));
            let contents = if let Some(file) = file {
                shell
                    .vfs
                    .read(&shell.resolve(file)?)
                    .map_err(|e| format!("wc: {file}: {e}"))?
            } else {
                stdin.to_vec()
            };
            let lines = contents.iter().filter(|&&b| b == b'\n').count();
            if rest.contains(&"-l") {
                format!("{lines}\n")
            } else {
                let words = contents
                    .split(|b| b.is_ascii_whitespace())
                    .filter(|part| !part.is_empty())
                    .count();
                format!("{lines} {words} {}\n", contents.len())
            }
        }
        "true" => String::new(),
        "false" => return Err("false".into()),
        "exit" => {
            shell.exited = true;
            "bye\n".to_owned()
        }
        other => {
            return Err(format!(
                "{other}: command not found (local wasm shell; connect a backend for more)"
            ));
        }
    };
    Ok(text.into_bytes())
}
