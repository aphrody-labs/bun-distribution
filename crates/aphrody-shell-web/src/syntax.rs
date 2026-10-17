// SPDX-License-Identifier: Apache-2.0
//! Small shell lexer. Quoting and escaping are retained until command execution.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Atom {
    Literal(char, bool),
    Variable(String, bool),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Word(pub Vec<Atom>);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Token {
    Word(Word),
    Pipe,
    And,
    Or,
    Read,
    Write,
    Append,
}

pub fn tokenize(line: &str) -> Result<Vec<Token>, String> {
    let mut tokens = Vec::new();
    let mut chars = line.chars().peekable();
    let mut word = Vec::new();
    let mut started = false;
    let mut quote = None;
    while let Some(ch) = chars.next() {
        match ch {
            '\\' if quote != Some('\'') => {
                let escaped = chars.next().ok_or("trailing escape")?;
                word.push(Atom::Literal(escaped, false));
                started = true;
            }
            '\'' | '"' if quote == Some(ch) => quote = None,
            '\'' | '"' if quote.is_none() => {
                quote = Some(ch);
                started = true;
            }
            '$' if quote != Some('\'') => {
                let name = if chars.peek() == Some(&'{') {
                    chars.next();
                    let mut name = String::new();
                    while let Some(&c) = chars.peek() {
                        if c == '}' {
                            break;
                        }
                        name.push(c);
                        chars.next();
                    }
                    if chars.next() != Some('}') {
                        return Err("unterminated variable".into());
                    }
                    name
                } else {
                    let mut name = String::new();
                    while let Some(&c) = chars.peek() {
                        if !(c.is_ascii_alphanumeric() || c == '_') {
                            break;
                        }
                        name.push(c);
                        chars.next();
                    }
                    name
                };
                if name.is_empty() {
                    word.push(Atom::Literal('$', false));
                } else {
                    word.push(Atom::Variable(name, quote.is_none()));
                }
                started = true;
            }
            c if c.is_whitespace() && quote.is_none() => {
                flush(&mut tokens, &mut word, &mut started);
            }
            '|' | '&' | '<' | '>' if quote.is_none() => {
                flush(&mut tokens, &mut word, &mut started);
                let token = match (ch, chars.peek().copied()) {
                    ('|', Some('|')) => {
                        chars.next();
                        Token::Or
                    }
                    ('|', _) => Token::Pipe,
                    ('&', Some('&')) => {
                        chars.next();
                        Token::And
                    }
                    ('&', _) => return Err("unsupported operator &".into()),
                    ('<', _) => Token::Read,
                    ('>', Some('>')) => {
                        chars.next();
                        Token::Append
                    }
                    ('>', _) => Token::Write,
                    _ => unreachable!(),
                };
                tokens.push(token);
            }
            _ => {
                word.push(Atom::Literal(ch, quote.is_none()));
                started = true;
            }
        }
    }
    if quote.is_some() {
        return Err("unterminated quote".into());
    }
    flush(&mut tokens, &mut word, &mut started);
    Ok(tokens)
}

fn flush(tokens: &mut Vec<Token>, word: &mut Vec<Atom>, started: &mut bool) {
    if *started {
        tokens.push(Token::Word(Word(std::mem::take(word))));
        *started = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn operators_only_outside_quotes() {
        let tokens = tokenize("echo 'a|b' \"c>d\" | cat && echo ok > out").unwrap();
        assert_eq!(
            tokens.iter().filter(|t| matches!(t, Token::Pipe)).count(),
            1
        );
        assert_eq!(tokens.iter().filter(|t| matches!(t, Token::And)).count(), 1);
        assert_eq!(
            tokens.iter().filter(|t| matches!(t, Token::Write)).count(),
            1
        );
        assert_eq!(tokens.len(), 10);
    }

    #[test]
    fn empty_quotes_and_errors() {
        assert_eq!(tokenize("''").unwrap(), vec![Token::Word(Word(vec![]))]);
        assert!(tokenize("'bad").is_err());
        assert!(tokenize("a \\").is_err());
        assert!(tokenize("$\u{7b}bad").is_err());
        assert!(tokenize("echo &").is_err());
    }
}
