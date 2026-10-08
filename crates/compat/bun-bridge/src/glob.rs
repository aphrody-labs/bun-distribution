// SPDX-License-Identifier: Apache-2.0
//! Native Glob pattern compiler and matcher from Bun (`bun_glob`).
//! Supports:
//! - Single wildcard `*` (matching within path segment)
//! - Double wildcard `**` (matching across directory segments)
//! - Single character `?`
//! - Character groups `[abc]`, `[0-9]`
//! - Negation patterns starting with `!`

/// Compiled glob pattern matcher.
#[derive(Debug, Clone)]
pub struct GlobMatcher {
    pattern: String,
    negated: bool,
    regex: regex::Regex,
}

impl GlobMatcher {
    /// Compiles a glob pattern into an efficient matching machine.
    pub fn compile(pat: &str) -> Result<Self, String> {
        let (negated, raw_pat) = if let Some(stripped) = pat.strip_prefix('!') {
            (true, stripped)
        } else {
            (false, pat)
        };

        let mut rx = String::from("^");
        let mut chars = raw_pat.chars().peekable();

        while let Some(c) = chars.next() {
            match c {
                '*' => {
                    if chars.peek() == Some(&'*') {
                        chars.next();
                        if chars.peek() == Some(&'/') {
                            chars.next();
                            rx.push_str("(?:.*/)?");
                        } else {
                            rx.push_str(".*");
                        }
                    } else {
                        rx.push_str("[^/]*");
                    }
                }
                '?' => rx.push_str("[^/]"),
                '.' | '+' | '(' | ')' | '{' | '}' | '^' | '$' | '|' => {
                    rx.push('\\');
                    rx.push(c);
                }
                '[' => {
                    rx.push('[');
                    while let Some(&inner) = chars.peek() {
                        chars.next();
                        rx.push(inner);
                        if inner == ']' {
                            break;
                        }
                    }
                }
                '\\' => {
                    if let Some(next) = chars.next() {
                        rx.push('\\');
                        rx.push(next);
                    }
                }
                other => rx.push(other),
            }
        }
        rx.push('$');

        let regex = regex::Regex::new(&rx).map_err(|e| e.to_string())?;

        Ok(Self {
            pattern: pat.to_string(),
            negated,
            regex,
        })
    }

    /// Evaluates if a given path matches the compiled glob.
    pub fn is_match(&self, path: &str) -> bool {
        let norm = path.replace('\\', "/");
        let matched = self.regex.is_match(&norm);
        if self.negated {
            !matched
        } else {
            matched
        }
    }

    /// The original raw pattern.
    pub fn pattern(&self) -> &str {
        &self.pattern
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_glob_matching() {
        let g1 = GlobMatcher::compile("src/**/*.rs").unwrap();
        assert!(g1.is_match("src/main.rs"));
        assert!(g1.is_match("src/shell/parser.rs"));
        assert!(!g1.is_match("crates/shell/parser.rs"));
        assert!(!g1.is_match("src/main.ts"));

        let g2 = GlobMatcher::compile("*.json").unwrap();
        assert!(g2.is_match("package.json"));
        assert!(!g2.is_match("src/package.json"));

        let g3 = GlobMatcher::compile("!*.log").unwrap();
        assert!(g3.is_match("server.ts"));
        assert!(!g3.is_match("debug.log"));
    }
}
