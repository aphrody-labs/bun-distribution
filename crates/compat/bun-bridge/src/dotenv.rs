// SPDX-License-Identifier: Apache-2.0
//! Native `.env` parser matching Bun's `bun_dotenv` (`thirdparty/dotenv`).
//! Supports:
//! - `#` comments
//! - `export KEY=value` prefix
//! - Single and double quotes with escape sequences (`\n`, `\t`, `\"`)
//! - Parameter expansion: `${VAR}` and `${VAR:-default}`
//! - Multiline string values

use std::collections::HashMap;

/// Parses a `.env` file content into key-value pairs, resolving variable substitutions.
pub fn parse_dotenv(content: &str) -> HashMap<String, String> {
    let mut vars = HashMap::new();
    let mut lines = content.lines().peekable();

    while let Some(line) = lines.next() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let clean_line = if let Some(stripped) = trimmed.strip_prefix("export ") {
            stripped.trim()
        } else {
            trimmed
        };

        if let Some((raw_key, raw_val)) = clean_line.split_once('=') {
            let key = raw_key.trim().to_string();
            let mut val_str = raw_val.trim();

            let value = if let Some(stripped) = val_str.strip_prefix('"') {
                if val_str.ends_with('"') && val_str.len() >= 2 {
                    unescape_double_quotes(&val_str[1..val_str.len() - 1])
                } else {
                    // Multiline string
                    let mut accum = String::from(stripped);
                    let mut closed = false;
                    for next_line in lines.by_ref() {
                        accum.push('\n');
                        if let Some(pos) = next_line.find('"') {
                            accum.push_str(&next_line[..pos]);
                            closed = true;
                            break;
                        } else {
                            accum.push_str(next_line);
                        }
                    }
                    if closed {
                        unescape_double_quotes(&accum)
                    } else {
                        accum
                    }
                }
            } else if let Some(stripped) = val_str.strip_prefix('\'') {
                if val_str.ends_with('\'') && val_str.len() >= 2 {
                    val_str[1..val_str.len() - 1].to_string()
                } else {
                    let mut accum = String::from(stripped);
                    for next_line in lines.by_ref() {
                        accum.push('\n');
                        if let Some(pos) = next_line.find('\'') {
                            accum.push_str(&next_line[..pos]);
                            break;
                        } else {
                            accum.push_str(next_line);
                        }
                    }
                    accum
                }
            } else {
                // Strip inline comment if any
                if let Some((v, _)) = val_str.split_once('#') {
                    val_str = v.trim();
                }
                val_str.to_string()
            };

            let expanded = expand_variables(&value, &vars);
            vars.insert(key, expanded);
        }
    }

    vars
}

fn unescape_double_quotes(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('r') => out.push('\r'),
                Some('t') => out.push('\t'),
                Some('\\') => out.push('\\'),
                Some('"') => out.push('"'),
                Some('$') => out.push('$'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn expand_variables(input: &str, env: &HashMap<String, String>) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '$' && chars.peek() == Some(&'{') {
            chars.next(); // Consume '{'
            let mut var_expr = String::new();
            while let Some(&ch) = chars.peek() {
                if ch == '}' {
                    chars.next();
                    break;
                }
                var_expr.push(ch);
                chars.next();
            }

            if let Some((name, default_val)) = var_expr.split_once(":-") {
                if let Some(val) = env.get(name) {
                    if !val.is_empty() {
                        result.push_str(val);
                    } else {
                        result.push_str(default_val);
                    }
                } else if let Ok(val) = std::env::var(name) {
                    if !val.is_empty() {
                        result.push_str(&val);
                    } else {
                        result.push_str(default_val);
                    }
                } else {
                    result.push_str(default_val);
                }
            } else {
                let name = var_expr.as_str();
                if let Some(val) = env.get(name) {
                    result.push_str(val);
                } else if let Ok(val) = std::env::var(name) {
                    result.push_str(&val);
                }
            }
        } else {
            result.push(c);
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_dotenv_basic_and_quotes() {
        let env_text = r#"
# Comment
PORT=3000
HOST="127.0.0.1"
GREETING='Hello World'
EXPORTED=export OK=1
"#;
        let vars = parse_dotenv(env_text);
        assert_eq!(vars.get("PORT"), Some(&"3000".to_string()));
        assert_eq!(vars.get("HOST"), Some(&"127.0.0.1".to_string()));
        assert_eq!(vars.get("GREETING"), Some(&"Hello World".to_string()));
    }

    #[test]
    fn test_parse_dotenv_expansion() {
        let env_text = r#"
BASE_DIR=/home/aphro
DATA_DIR=${BASE_DIR}/data
UNKNOWN=${NON_EXISTENT:-/tmp/fallback}
"#;
        let vars = parse_dotenv(env_text);
        assert_eq!(vars.get("DATA_DIR"), Some(&"/home/aphro/data".to_string()));
        assert_eq!(vars.get("UNKNOWN"), Some(&"/tmp/fallback".to_string()));
    }
}
