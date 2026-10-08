// SPDX-License-Identifier: Apache-2.0
//! File classification and structural extraction.

use std::{fs, path::Path};

use anyhow::{Context, Result};
use oxc_allocator::Allocator;
use oxc_ast::{
  AstKind,
  ast::{Argument, Expression, VariableDeclarationKind},
};
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_span::SourceType;
use regex::Regex;
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct LanguageDefinition {
  pub id: &'static str,
  pub name: &'static str,
  pub category: &'static str,
  pub extensions: &'static [&'static str],
  pub filenames: &'static [&'static str],
  pub shebangs: &'static [&'static str],
  pub test_runner: Option<&'static str>,
  pub build_gate: Option<&'static str>,
  pub mime_type: &'static str,
}

macro_rules! language {
    ($id:literal, $name:literal, $category:literal, [$($extension:literal),*], [$($filename:literal),*], [$($shebang:literal),*], $test:expr, $build:expr, $mime:literal) => {
        LanguageDefinition { id: $id, name: $name, category: $category, extensions: &[$($extension),*], filenames: &[$($filename),*], shebangs: &[$($shebang),*], test_runner: $test, build_gate: $build, mime_type: $mime }
    };
}

pub static LANGUAGE_REGISTRY: &[LanguageDefinition] = &[
  language!(
    "rust",
    "Rust",
    "programming",
    [".rs"],
    ["Cargo.toml"],
    [],
    Some("cargo test"),
    Some("cargo check --workspace --all-targets"),
    "text/x-rust"
  ),
  language!(
    "typescript",
    "TypeScript",
    "programming",
    [".ts", ".tsx", ".mts", ".cts"],
    ["tsconfig.json"],
    ["bun", "deno", "ts-node"],
    Some("bun test"),
    Some("tsc --noEmit"),
    "application/typescript"
  ),
  language!(
    "javascript",
    "JavaScript",
    "programming",
    [".js", ".jsx", ".mjs", ".cjs"],
    ["package.json"],
    ["node", "bun"],
    Some("bun test"),
    None,
    "application/javascript"
  ),
  language!(
    "python",
    "Python",
    "programming",
    [".py", ".pyw", ".pyi"],
    ["pyproject.toml", "requirements.txt", "Pipfile"],
    ["python", "python3", "uv run"],
    Some("pytest || python -m unittest"),
    Some("python -m py_compile"),
    "text/x-python"
  ),
  language!(
    "csharp",
    "C#",
    "programming",
    [".cs", ".csx"],
    [],
    [],
    Some("dotnet test"),
    Some("dotnet build"),
    "text/x-csharp"
  ),
  language!(
    "cpp",
    "C++",
    "programming",
    [".cpp", ".cxx", ".cc", ".hpp", ".hxx", ".hh"],
    ["CMakeLists.txt"],
    [],
    Some("ctest || make test"),
    Some("cmake --build . || make"),
    "text/x-c++src"
  ),
  language!(
    "c",
    "C",
    "programming",
    [".c", ".h"],
    ["Makefile"],
    [],
    Some("make test"),
    Some("make"),
    "text/x-csrc"
  ),
  language!(
    "assembly",
    "Assembly",
    "programming",
    [".asm", ".s", ".nasm"],
    [],
    [],
    None,
    Some("nasm -f elf64 || as"),
    "text/x-asm"
  ),
  language!(
    "go",
    "Go",
    "programming",
    [".go"],
    ["go.mod"],
    [],
    Some("go test ..."),
    Some("go build ..."),
    "text/x-go"
  ),
  language!(
    "java",
    "Java",
    "programming",
    [".java"],
    ["pom.xml", "build.gradle"],
    [],
    Some("mvn test || ./gradlew test"),
    Some("javac"),
    "text/x-java"
  ),
  language!(
    "kotlin",
    "Kotlin",
    "programming",
    [".kt", ".kts"],
    [],
    [],
    Some("./gradlew test"),
    Some("kotlinc"),
    "text/x-kotlin"
  ),
  language!(
    "swift",
    "Swift",
    "programming",
    [".swift"],
    ["Package.swift"],
    [],
    Some("swift test"),
    Some("swift build"),
    "text/x-swift"
  ),
  language!(
    "ruby",
    "Ruby",
    "programming",
    [".rb", ".rake"],
    ["Gemfile", "Rakefile"],
    ["ruby"],
    Some("bundle exec rspec"),
    None,
    "text/x-ruby"
  ),
  language!(
    "php",
    "PHP",
    "programming",
    [".php", ".phtml"],
    ["composer.json"],
    ["php"],
    Some("./vendor/bin/phpunit"),
    None,
    "application/x-httpd-php"
  ),
  language!(
    "shell",
    "Shell",
    "programming",
    [".sh", ".bash", ".zsh"],
    [],
    ["bash", "sh", "zsh"],
    Some("bats test"),
    Some("bash -n"),
    "application/x-sh"
  ),
  language!(
    "powershell",
    "PowerShell",
    "programming",
    [".ps1", ".psm1", ".psd1"],
    [],
    ["pwsh", "powershell"],
    Some("Invoke-Pester"),
    None,
    "application/x-powershell"
  ),
  language!(
    "html",
    "HTML",
    "markup",
    [".html", ".htm"],
    [],
    [],
    None,
    None,
    "text/html"
  ),
  language!(
    "css",
    "CSS",
    "markup",
    [".css", ".scss", ".sass", ".less"],
    [],
    [],
    None,
    None,
    "text/css"
  ),
  language!(
    "json",
    "JSON",
    "data",
    [".json", ".jsonc", ".jsonl"],
    [],
    [],
    None,
    None,
    "application/json"
  ),
  language!(
    "yaml",
    "YAML",
    "data",
    [".yaml", ".yml"],
    [],
    [],
    None,
    None,
    "text/yaml"
  ),
  language!(
    "toml",
    "TOML",
    "data",
    [".toml"],
    [],
    [],
    None,
    None,
    "application/toml"
  ),
  language!(
    "markdown",
    "Markdown",
    "prose",
    [".md", ".markdown", ".mdown"],
    [],
    [],
    None,
    None,
    "text/markdown"
  ),
  language!(
    "sql",
    "SQL",
    "data",
    [".sql"],
    [],
    [],
    None,
    None,
    "application/sql"
  ),
  language!(
    "dockerfile",
    "Dockerfile",
    "config",
    [".dockerfile"],
    ["Dockerfile", "Containerfile"],
    [],
    None,
    None,
    "text/x-dockerfile"
  ),
  language!(
    "pseudocode",
    "Pseudocode",
    "prose",
    [".pseudo", ".algo"],
    [],
    [],
    None,
    None,
    "text/x-pseudocode"
  ),
];

fn unknown() -> LanguageDefinition {
  LanguageDefinition {
    id: "unknown",
    name: "Plain Text",
    category: "prose",
    extensions: &[],
    filenames: &[],
    shebangs: &[],
    test_runner: None,
    build_gate: None,
    mime_type: "text/plain",
  }
}

fn by_id(id: &str) -> LanguageDefinition {
  LANGUAGE_REGISTRY
    .iter()
    .find(|language| language.id == id)
    .cloned()
    .expect("registry id")
}

pub fn detect(path: &Path, content: Option<&str>) -> LanguageDefinition {
  let filename = path
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or_default();
  let lowercase = filename.to_ascii_lowercase();
  if let Some(language) = LANGUAGE_REGISTRY.iter().find(|language| {
    language
      .filenames
      .iter()
      .any(|name| name.eq_ignore_ascii_case(filename))
  }) {
    return language.clone();
  }
  if let Some(first_line) = content
    .filter(|text| text.starts_with("#!"))
    .and_then(|text| text.lines().next())
    .map(str::to_ascii_lowercase)
    && let Some(language) = LANGUAGE_REGISTRY.iter().find(|language| {
      language
        .shebangs
        .iter()
        .any(|needle| first_line.contains(needle))
    })
  {
    return language.clone();
  }
  let extension = lowercase
    .rsplit_once('.')
    .map(|(_, extension)| format!(".{extension}"))
    .unwrap_or_default();
  if let Some(language) = LANGUAGE_REGISTRY
    .iter()
    .find(|language| language.extensions.contains(&extension.as_str()))
  {
    return language.clone();
  }
  if let Some(text) = content {
    let trimmed = text.trim();
    if matches!(trimmed.to_ascii_lowercase().as_str(), value if value.starts_with("<!doctype html") || value.starts_with("<html"))
    {
      return by_id("html");
    }
    if serde_json::from_str::<serde_json::Value>(trimmed).is_ok() {
      return by_id("json");
    }
  }
  unknown()
}

#[derive(Debug, Serialize)]
pub struct Declarations {
  pub classes: Vec<String>,
  pub functions: Vec<String>,
  pub interfaces: Vec<String>,
  /// Module-level constants; constants local to a function or block are not listed.
  pub constants: Vec<String>,
  /// Enum names.
  pub enums: Vec<String>,
  /// Enum variants as `Enum.Variant`.
  pub enum_variants: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ParseResult {
  pub language: String,
  pub category: String,
  pub mime_type: String,
  pub is_binary: bool,
  pub total_lines: usize,
  pub code_lines: usize,
  pub comment_lines: usize,
  pub blank_lines: usize,
  pub imports: Vec<String>,
  pub declarations: Declarations,
  pub validation_gate: Option<String>,
  #[serde(skip_serializing_if = "Vec::is_empty")]
  pub diagnostics: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct FileDetection {
  pub path: String,
  pub is_binary: bool,
  pub definition: LanguageDefinition,
  pub parse: Option<ParseResult>,
}

fn captures(pattern: &str, text: &str) -> Option<String> {
  Regex::new(pattern)
    .expect("static regex")
    .captures(text)
    .and_then(|captures| captures.get(1))
    .map(|capture| capture.as_str().to_owned())
}

fn push_unique(values: &mut Vec<String>, value: Option<String>) {
  if let Some(value) = value.filter(|value| !values.contains(value)) {
    values.push(value);
  }
}

#[derive(Default)]
struct JsDeclarations {
  classes: Vec<String>,
  functions: Vec<String>,
  interfaces: Vec<String>,
  constants: Vec<String>,
  enums: Vec<String>,
  enum_variants: Vec<String>,
  imports: Vec<(u32, String)>,
  /// Nesting inside function bodies, blocks, loops and namespaces.
  depth: usize,
}

fn opens_scope(node: &AstKind<'_>) -> bool {
  matches!(
    node,
    AstKind::FunctionBody(_)
      | AstKind::BlockStatement(_)
      | AstKind::StaticBlock(_)
      | AstKind::SwitchStatement(_)
      | AstKind::ForStatement(_)
      | AstKind::ForInStatement(_)
      | AstKind::ForOfStatement(_)
      | AstKind::TSModuleBlock(_)
  )
}

impl<'a> Visit<'a> for JsDeclarations {
  fn leave_node(&mut self, node: AstKind<'a>) {
    if opens_scope(&node) {
      self.depth -= 1;
    }
  }

  fn enter_node(&mut self, node: AstKind<'a>) {
    if opens_scope(&node) {
      self.depth += 1;
    }
    match node {
      AstKind::Function(node) => push_unique(
        &mut self.functions,
        node.id.as_ref().map(|id| id.name.to_string()),
      ),
      AstKind::Class(node) => push_unique(
        &mut self.classes,
        node.id.as_ref().map(|id| id.name.to_string()),
      ),
      AstKind::TSInterfaceDeclaration(node) => {
        push_unique(&mut self.interfaces, Some(node.id.name.to_string()))
      }
      AstKind::VariableDeclaration(node)
        if node.kind == VariableDeclarationKind::Const && self.depth == 0 =>
      {
        for declaration in &node.declarations {
          for id in declaration.id.get_binding_identifiers() {
            push_unique(&mut self.constants, Some(id.name.to_string()));
          }
        }
      }
      AstKind::TSEnumDeclaration(node) => {
        let name = node.id.name.to_string();
        for member in &node.body.members {
          push_unique(
            &mut self.enum_variants,
            Some(format!("{name}.{}", member.id.static_name())),
          );
        }
        push_unique(&mut self.enums, Some(name));
      }
      AstKind::CallExpression(node) if node.is_require_call() => {
        if let Some(Argument::StringLiteral(source)) = node.arguments.first() {
          self
            .imports
            .push((source.span.start, source.value.to_string()));
        }
      }
      AstKind::ImportExpression(node) => {
        if let Expression::StringLiteral(source) = &node.source {
          self
            .imports
            .push((source.span.start, source.value.to_string()));
        }
      }
      _ => {}
    }
  }
}

pub fn parse(path: &Path, content: &str) -> ParseResult {
  let definition = detect(path, Some(content));
  let mut imports = Vec::new();
  let mut classes = Vec::new();
  let mut functions = Vec::new();
  let mut interfaces = Vec::new();
  let mut constants = Vec::new();
  let mut enums = Vec::new();
  let mut enum_variants = Vec::new();
  let mut blank_lines = 0;
  let mut comment_lines = 0;
  let mut code_lines = 0;
  let mut in_block_comment = false;
  let is_js = matches!(definition.id, "typescript" | "javascript");
  for raw in content.lines().filter(|_| !is_js) {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
      blank_lines += 1;
      continue;
    }
    let mut line = trimmed;
    if in_block_comment {
      comment_lines += 1;
      if let Some((_, rest)) = line.split_once("*/") {
        in_block_comment = false;
        line = rest.trim();
      } else {
        continue;
      }
    }
    if line.starts_with("/*") {
      comment_lines += 1;
      if !line.contains("*/") {
        in_block_comment = true;
      }
      continue;
    }
    if line.starts_with("//")
      || line.starts_with('#')
      || line.starts_with(';')
      || line.starts_with("--")
    {
      comment_lines += 1;
      continue;
    }
    code_lines += 1;
    match definition.id {
      "rust" => {
        push_unique(&mut imports, captures(r"^(?:pub\s+)?use\s+([\w:]+)", line));
        push_unique(
          &mut functions,
          captures(r"^(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+(\w+)", line),
        );
        push_unique(
          &mut classes,
          captures(r"^(?:pub(?:\([^)]+\))?\s+)?struct\s+(\w+)", line),
        );
        push_unique(
          &mut enums,
          captures(r"^(?:pub(?:\([^)]+\))?\s+)?enum\s+(\w+)", line),
        );
        push_unique(
          &mut interfaces,
          captures(r"^(?:pub\s+)?trait\s+(\w+)", line),
        );
        push_unique(&mut constants, captures(r"^(?:pub\s+)?const\s+(\w+)", line));
      }
      "python" => {
        push_unique(
          &mut imports,
          captures(r"^from\s+([\w.]+)\s+import", line)
            .or_else(|| captures(r"^import\s+([\w.]+)", line)),
        );
        push_unique(&mut functions, captures(r"^(?:async\s+)?def\s+(\w+)", line));
        push_unique(&mut classes, captures(r"^class\s+(\w+)", line));
      }
      "csharp" => {
        push_unique(&mut imports, captures(r"^using\s+([\w.]+);", line));
        push_unique(&mut classes, captures(r"\bclass\s+(\w+)", line));
        push_unique(&mut interfaces, captures(r"\binterface\s+(\w+)", line));
      }
      "c" | "cpp" => {
        push_unique(
          &mut imports,
          captures(r#"^#include\s*[<\"]([^>\"]+)[>\"]"#, line),
        );
        push_unique(&mut classes, captures(r"^class\s+(\w+)", line));
        push_unique(
          &mut functions,
          captures(r"^[\w*&]+\s+(\w+)\s*\([^)]*\)\s*\{", line),
        );
      }
      "go" => {
        push_unique(&mut imports, captures(r#"^import\s+[\"'](.*?)[\"']"#, line));
        push_unique(
          &mut functions,
          captures(r"^func\s+(?:\([^)]+\)\s+)?(\w+)", line),
        );
        push_unique(&mut classes, captures(r"^type\s+(\w+)\s+struct", line));
        push_unique(
          &mut interfaces,
          captures(r"^type\s+(\w+)\s+interface", line),
        );
      }
      "assembly" => push_unique(&mut functions, captures(r"^(\w+):", line)),
      _ => {}
    }
  }
  let mut diagnostics = Vec::new();
  if is_js {
    let allocator = Allocator::default();
    let parsed = Parser::new(
      &allocator,
      content,
      SourceType::from_path(path).unwrap_or_default(),
    )
    .parse();
    diagnostics = parsed.diagnostics.iter().map(ToString::to_string).collect();
    let mut offset = 0usize;
    for line in content.lines() {
      if line.trim().is_empty() {
        blank_lines += 1;
      } else {
        let code = line.char_indices().any(|(index, character)| {
          let position = offset + index;
          let next = parsed
            .program
            .comments
            .partition_point(|comment| comment.span.end as usize <= position);
          !character.is_whitespace()
            && !parsed
              .program
              .comments
              .get(next)
              .is_some_and(|comment| comment.span.start as usize <= position)
        });
        if code {
          code_lines += 1;
        } else {
          comment_lines += 1;
        }
      }
      // lines() strips CRLF; locate the next raw line without losing byte offsets.
      offset += content[offset..]
        .find('\n')
        .map_or(content.len() - offset, |n| n + 1);
    }
    if diagnostics.is_empty() {
      let mut requested: Vec<(u32, String)> = parsed
        .module_record
        .requested_modules
        .iter()
        .flat_map(|(name, uses)| {
          uses
            .iter()
            .map(move |usage| (usage.span.start, name.to_string()))
        })
        .collect();
      let mut declarations = JsDeclarations::default();
      declarations.visit_program(&parsed.program);
      requested.extend(declarations.imports);
      requested.sort_unstable_by_key(|(start, _)| *start);
      for (_, name) in requested {
        push_unique(&mut imports, Some(name));
      }
      classes = declarations.classes;
      functions = declarations.functions;
      interfaces = declarations.interfaces;
      constants = declarations.constants;
      enums = declarations.enums;
      enum_variants = declarations.enum_variants;
    }
  }
  let validation_gate = match (definition.build_gate, definition.test_runner) {
    (Some(build), Some(test)) => Some(format!("{build} && {test}")),
    (Some(build), None) => Some(build.to_owned()),
    (None, Some(test)) => Some(test.to_owned()),
    (None, None) => None,
  };
  ParseResult {
    language: definition.name.to_owned(),
    category: definition.category.to_owned(),
    mime_type: definition.mime_type.to_owned(),
    is_binary: false,
    total_lines: content.lines().count(),
    code_lines,
    comment_lines,
    blank_lines,
    imports,
    declarations: Declarations {
      classes,
      functions,
      interfaces,
      constants,
      enums,
      enum_variants,
    },
    validation_gate,
    diagnostics,
  }
}

pub fn inspect_file(path: &Path) -> Result<FileDetection> {
  let bytes = fs::read(path).with_context(|| format!("cannot read {}", path.display()))?;
  if bytes.contains(&0) {
    return Ok(FileDetection {
      path: path.display().to_string(),
      is_binary: true,
      definition: LanguageDefinition {
        id: "binary",
        name: "Binary",
        category: "binary",
        extensions: &[],
        filenames: &[],
        shebangs: &[],
        test_runner: None,
        build_gate: None,
        mime_type: "application/octet-stream",
      },
      parse: None,
    });
  }
  let content = String::from_utf8_lossy(&bytes);
  let definition = detect(path, Some(&content));
  Ok(FileDetection {
    path: path.display().to_string(),
    is_binary: false,
    definition,
    parse: Some(parse(path, &content)),
  })
}

#[cfg(test)]
mod tests {
  use std::path::Path;

  use super::*;
  #[test]
  fn detects_exact_filename() {
    assert_eq!(detect(Path::new("Cargo.toml"), None).id, "rust");
  }
  #[test]
  fn detects_shebang() {
    assert_eq!(
      detect(Path::new("tool"), Some("#!/usr/bin/env python3\n")).id,
      "python"
    );
  }
  #[test]
  fn detects_polyglot_extensions_and_build_files() {
    assert_eq!(detect(Path::new("engine.cs"), None).id, "csharp");
    assert_eq!(detect(Path::new("CMakeLists.txt"), None).id, "cpp");
    assert_eq!(detect(Path::new("kernel.nasm"), None).id, "assembly");
    assert_eq!(detect(Path::new("service.go"), None).id, "go");
  }
  #[test]
  fn parses_rust_symbols() {
    let result = parse(
      Path::new("lib.rs"),
      "use std::fs;\npub struct Engine;\npub(crate) enum Kind { A }\npub trait Run {}\npub fn execute() {}\n",
    );
    assert_eq!(result.imports, ["std::fs"]);
    assert_eq!(result.declarations.classes, ["Engine"]);
    assert_eq!(result.declarations.enums, ["Kind"]);
    assert_eq!(result.declarations.functions, ["execute"]);
  }
}
