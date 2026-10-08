// SPDX-License-Identifier: Apache-2.0
//! Shell AST representations.

/// Redirection target and mode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Redirection {
    /// Read stdin from file `< file`
    FileIn(String),
    /// Overwrite stdout to file `> file`
    FileOut(String),
    /// Append stdout to file `>> file`
    FileAppend(String),
    /// Overwrite stderr to file `2> file`
    FileErr(String),
    /// Append stderr to file `2>> file`
    FileErrAppend(String),
}

/// A single command invocation with arguments and redirections.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Command {
    /// Expanded argument vector (`argv[0]` is command name).
    pub argv: Vec<String>,
    /// Active redirections.
    pub redirections: Vec<Redirection>,
}

impl Command {
    /// Return the command name if non-empty.
    pub fn name(&self) -> Option<&str> {
        self.argv.first().map(|s| s.as_str())
    }

    /// Check if this command is empty.
    pub fn is_empty(&self) -> bool {
        self.argv.is_empty()
    }
}

/// A pipeline of commands connected by pipes (`|`).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Pipeline {
    /// Individual commands in the pipeline.
    pub commands: Vec<Command>,
}

/// Logical operator connecting pipelines.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    /// Sequential execution (`;` or `\n`)
    Seq,
    /// Logical AND (`&&`)
    And,
    /// Logical OR (`||`)
    Or,
}

/// Complete shell script composed of pipelines connected by control operators.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Script {
    /// (Pipeline, following operator to next pipeline)
    pub pipelines: Vec<(Pipeline, Option<Op>)>,
}
