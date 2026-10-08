// SPDX-License-Identifier: Apache-2.0
//! Fast shell parser with quoting, redirection, and braces expansion.

use super::ast::{Command, Op, Pipeline, Redirection, Script};
use super::braces::expand_braces;

/// Parse a raw shell string into an executable `Script` AST.
pub fn parse_script(input: &str) -> Result<Script, String> {
    let mut pipelines = Vec::new();
    let tokens = tokenize(input)?;

    let mut current_pipeline = Pipeline::default();
    let mut current_cmd = Command::default();
    let mut i = 0;
    let n = tokens.len();

    while i < n {
        match &tokens[i] {
            Token::Word(w) => {
                // Check if this word starts with redirection
                current_cmd.argv.push(w.clone());
                i += 1;
            }
            Token::Redirect(redir) => {
                current_cmd.redirections.push(redir.clone());
                i += 1;
            }
            Token::Pipe => {
                if !current_cmd.is_empty() || !current_cmd.redirections.is_empty() {
                    current_pipeline.commands.push(std::mem::take(&mut current_cmd));
                }
                i += 1;
            }
            Token::Control(op) => {
                if !current_cmd.is_empty() || !current_cmd.redirections.is_empty() {
                    current_pipeline.commands.push(std::mem::take(&mut current_cmd));
                }
                if !current_pipeline.commands.is_empty() {
                    pipelines.push((std::mem::take(&mut current_pipeline), Some(*op)));
                }
                i += 1;
            }
        }
    }

    if !current_cmd.is_empty() || !current_cmd.redirections.is_empty() {
        current_pipeline.commands.push(current_cmd);
    }
    if !current_pipeline.commands.is_empty() {
        pipelines.push((current_pipeline, None));
    }

    Ok(Script { pipelines })
}

#[derive(Debug, PartialEq, Eq)]
enum Token {
    Word(String),
    Redirect(Redirection),
    Pipe,
    Control(Op),
}

fn tokenize(input: &str) -> Result<Vec<Token>, String> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = input.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        let c = chars[i];

        // Whitespace
        if c.is_whitespace() {
            if c == '\n' {
                tokens.push(Token::Control(Op::Seq));
            }
            i += 1;
            continue;
        }

        // Comments
        if c == '#' {
            while i < len && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }

        // Operators
        if c == ';' {
            tokens.push(Token::Control(Op::Seq));
            i += 1;
            continue;
        }

        if c == '&' {
            if i + 1 < len && chars[i + 1] == '&' {
                tokens.push(Token::Control(Op::And));
                i += 2;
                continue;
            }
            // Background & treated as seq separator for now
            tokens.push(Token::Control(Op::Seq));
            i += 1;
            continue;
        }

        if c == '|' {
            if i + 1 < len && chars[i + 1] == '|' {
                tokens.push(Token::Control(Op::Or));
                i += 2;
                continue;
            }
            tokens.push(Token::Pipe);
            i += 1;
            continue;
        }

        // Redirections
        if c == '>' {
            if i + 1 < len && chars[i + 1] == '>' {
                i += 2;
                let target = read_word_target(&chars, &mut i)?;
                tokens.push(Token::Redirect(Redirection::FileAppend(target)));
            } else {
                i += 1;
                let target = read_word_target(&chars, &mut i)?;
                tokens.push(Token::Redirect(Redirection::FileOut(target)));
            }
            continue;
        }

        if c == '<' {
            i += 1;
            let target = read_word_target(&chars, &mut i)?;
            tokens.push(Token::Redirect(Redirection::FileIn(target)));
            continue;
        }

        if c == '2' && i + 1 < len && chars[i + 1] == '>' {
            if i + 2 < len && chars[i + 2] == '>' {
                i += 3;
                let target = read_word_target(&chars, &mut i)?;
                tokens.push(Token::Redirect(Redirection::FileErrAppend(target)));
            } else {
                i += 2;
                let target = read_word_target(&chars, &mut i)?;
                tokens.push(Token::Redirect(Redirection::FileErr(target)));
            }
            continue;
        }

        // Words (with quotes, escapes, and braces expansion)
        let (raw_word, has_braces) = read_word(&chars, &mut i)?;
        if has_braces {
            for expanded in expand_braces(&raw_word) {
                tokens.push(Token::Word(expanded));
            }
        } else {
            tokens.push(Token::Word(raw_word));
        }
    }

    Ok(tokens)
}

fn read_word_target(chars: &[char], i: &mut usize) -> Result<String, String> {
    while *i < chars.len() && chars[*i].is_whitespace() && chars[*i] != '\n' {
        *i += 1;
    }
    if *i >= chars.len() {
        return Err("Unexpected end of input after redirection".to_string());
    }
    let (word, _) = read_word(chars, i)?;
    if word.is_empty() {
        return Err("Missing target for redirection".to_string());
    }
    Ok(word)
}

fn read_word(chars: &[char], i: &mut usize) -> Result<(String, bool), String> {
    let mut word = String::new();
    let mut has_braces = false;
    let len = chars.len();

    while *i < len {
        let c = chars[*i];
        if c.is_whitespace() || c == ';' || c == '|' || c == '&' || c == '>' || c == '<' {
            break;
        }

        if c == '{' || c == '}' {
            has_braces = true;
            word.push(c);
            *i += 1;
            continue;
        }

        if c == '\\' {
            if *i + 1 < len {
                word.push(chars[*i + 1]);
                *i += 2;
            } else {
                *i += 1;
            }
            continue;
        }

        if c == '\'' {
            // Single quotes: raw, no escape interpolation
            *i += 1;
            while *i < len && chars[*i] != '\'' {
                word.push(chars[*i]);
                *i += 1;
            }
            if *i >= len {
                return Err("Unterminated single quote".to_string());
            }
            *i += 1;
            continue;
        }

        if c == '"' {
            // Double quotes: allow escapes
            *i += 1;
            while *i < len && chars[*i] != '"' {
                if chars[*i] == '\\' && *i + 1 < len {
                    let next = chars[*i + 1];
                    if next == '"' || next == '\\' || next == '$' || next == '`' {
                        word.push(next);
                        *i += 2;
                        continue;
                    }
                }
                word.push(chars[*i]);
                *i += 1;
            }
            if *i >= len {
                return Err("Unterminated double quote".to_string());
            }
            *i += 1;
            continue;
        }

        word.push(c);
        *i += 1;
    }

    Ok((word, has_braces))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple() {
        let script = parse_script("echo hello world").unwrap();
        assert_eq!(script.pipelines.len(), 1);
        let pipe = &script.pipelines[0].0;
        assert_eq!(pipe.commands.len(), 1);
        assert_eq!(pipe.commands[0].argv, vec!["echo", "hello", "world"]);
    }

    #[test]
    fn test_parse_pipeline_and_braces() {
        let script = parse_script("echo {a,b} | cat > output.txt").unwrap();
        assert_eq!(script.pipelines.len(), 1);
        let pipe = &script.pipelines[0].0;
        assert_eq!(pipe.commands.len(), 2);
        assert_eq!(pipe.commands[0].argv, vec!["echo", "a", "b"]);
        assert_eq!(pipe.commands[1].argv, vec!["cat"]);
        assert_eq!(
            pipe.commands[1].redirections,
            vec![Redirection::FileOut("output.txt".to_string())]
        );
    }
}
