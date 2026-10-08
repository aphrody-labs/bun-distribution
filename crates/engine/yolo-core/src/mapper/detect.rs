// SPDX-License-Identifier: Apache-2.0
//! Workspace and runtime detection.

use std::path::Path;

use crate::mapper::core::RootKind;

/// Detect everything at the repository root in a single pass.
pub(crate) fn detect_root(root: &Path) -> RootKind {
  let mut k = RootKind::default();

  for lf in &[
    "bun.lock",
    "bun.lockb",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "Cargo.lock",
    "deno.lock",
  ] {
    if root.join(lf).exists() {
      k.lockfiles.push((*lf).to_string());
    }
  }

  // Bun (lock OR config)
  if root.join("bun.lock").exists()
    || root.join("bun.lockb").exists()
    || root.join("bunfig.toml").exists()
  {
    push_unique(&mut k.package_managers, "bun");
  }

  // pnpm
  if root.join("pnpm-lock.yaml").exists() || root.join("pnpm-workspace.yaml").exists() {
    push_unique(&mut k.package_managers, "pnpm");
  }
  k.has_pnpm_workspaces = root.join("pnpm-workspace.yaml").exists();

  // npm
  if root.join("package-lock.json").exists() {
    push_unique(&mut k.package_managers, "npm");
  }

  // yarn
  if root.join("yarn.lock").exists() {
    push_unique(&mut k.package_managers, "yarn");
  }

  // Turbo
  if root.join("turbo.json").exists() || root.join("turbo.jsonc").exists() {
    push_unique(&mut k.task_runners, "turbo");
    k.has_turbo = true;
  }

  // Nx
  if root.join("nx.json").exists() {
    push_unique(&mut k.task_runners, "nx");
    k.has_nx = true;
  }

  // Lerna
  if root.join("lerna.json").exists() {
    push_unique(&mut k.task_runners, "lerna");
    k.has_lerna = true;
  }

  // Deno
  if root.join("deno.json").exists() || root.join("deno.jsonc").exists() {
    k.has_deno = true;
    push_unique(&mut k.package_managers, "deno");
  }

  // Cargo workspace?
  if let Ok(s) = std::fs::read_to_string(root.join("Cargo.toml")) {
    k.has_cargo_workspace = s.contains("[workspace]");
  }

  // Bun/Node workspaces? (package.json with "workspaces")
  if let Ok(s) = std::fs::read_to_string(root.join("package.json"))
    && let Ok(v) = serde_json::from_str::<serde_json::Value>(&s)
    && v.get("workspaces").is_some()
  {
    k.has_bun_workspaces = true;
    push_unique(&mut k.package_managers, "bun");
  }

  k
}

/// Per-workspace runtime detection (called for each detected workspace dir).
pub(crate) fn detect_workspace_runtimes(dir: &Path) -> Vec<String> {
  let mut out = Vec::new();
  if dir.join("bunfig.toml").exists() || dir.join("bun.lock").exists() {
    out.push("bun".into());
  }
  if dir.join("turbo.json").exists() {
    out.push("turbo".into());
  }
  if dir.join("Cargo.toml").exists() {
    out.push("cargo".into());
  }
  if dir.join("package.json").exists() && !out.iter().any(|r| r == "bun") {
    out.push("node".into());
  }
  if dir.join("deno.json").exists() || dir.join("deno.jsonc").exists() {
    out.push("deno".into());
  }
  out
}

fn push_unique(v: &mut Vec<String>, s: &str) {
  if !v.iter().any(|x| x == s) {
    v.push(s.to_string());
  }
}

/// Workspace directories declared by the root manifests (Cargo `[workspace] members` minus
/// `exclude`, `package.json` `workspaces` as an array or `{ packages }`, `pnpm-workspace.yaml`
/// `packages`), relative to `root` with `/` separators, glob patterns expanded, sorted. Only
/// directories holding a `Cargo.toml` or `package.json` are kept.
pub fn declared_workspaces(root: &Path) -> Vec<String> {
  let mut patterns = Vec::new();
  let mut excluded = Vec::new();
  if let Ok(text) = std::fs::read_to_string(root.join("Cargo.toml")) {
    patterns.extend(toml_array(&text, "workspace", "members"));
    excluded.extend(toml_array(&text, "workspace", "exclude"));
  }
  if let Ok(text) = std::fs::read_to_string(root.join("package.json"))
    && let Ok(value) = serde_json::from_str::<serde_json::Value>(&text)
  {
    let list = match value.get("workspaces") {
      Some(serde_json::Value::Array(list)) => Some(list),
      Some(serde_json::Value::Object(object)) => object.get("packages").and_then(|p| p.as_array()),
      _ => None,
    };
    patterns.extend(list.into_iter().flatten().filter_map(|v| v.as_str()).map(str::to_owned));
  }
  if let Ok(text) = std::fs::read_to_string(root.join("pnpm-workspace.yaml")) {
    let mut in_packages = false;
    for line in text.lines() {
      if !line.starts_with([' ', '\t', '-']) {
        in_packages = line.trim_end() == "packages:";
        continue;
      }
      if let Some(item) = line.trim().strip_prefix('-').filter(|_| in_packages) {
        patterns.push(item.trim().trim_matches(['"', '\'']).to_owned());
      }
    }
  }
  let mut negated = Vec::new();
  let mut out = Vec::new();
  for pattern in patterns {
    let pattern = pattern.trim().trim_start_matches("./").trim_end_matches('/').to_owned();
    if let Some(negative) = pattern.strip_prefix('!') {
      negated.push(negative.trim_start_matches("./").to_owned());
    } else if !pattern.is_empty() {
      expand(root, &pattern, &mut out);
    }
  }
  excluded.extend(negated);
  let excluded: Vec<globset::GlobMatcher> = excluded
    .iter()
    .filter_map(|e| globset::Glob::new(e.trim_start_matches("./").trim_end_matches('/')).ok())
    .map(|g| g.compile_matcher())
    .collect();
  out.retain(|dir| {
    !excluded.iter().any(|e| e.is_match(dir))
      && (root.join(dir).join("Cargo.toml").is_file() || root.join(dir).join("package.json").is_file())
  });
  out.sort();
  out.dedup();
  out
}

/// String items of `key = [ ... ]` inside the `[table]` section of a TOML document.
fn toml_array(text: &str, table: &str, key: &str) -> Vec<String> {
  let mut in_table = false;
  let mut collecting = false;
  let mut items = Vec::new();
  for line in text.lines() {
    let line = line.split('#').next().unwrap_or("").trim();
    if !collecting && line.starts_with('[') {
      in_table = line == format!("[{table}]");
      continue;
    }
    let rest = if collecting {
      line
    } else if in_table
      && let Some(rest) = line.strip_prefix(key)
      && let Some(rest) = rest.trim_start().strip_prefix('=')
      && let Some(rest) = rest.trim_start().strip_prefix('[')
    {
      collecting = true;
      rest
    } else {
      continue;
    };
    let (body, done) = match rest.find(']') {
      Some(end) => (&rest[..end], true),
      None => (rest, false),
    };
    items.extend(
      body
        .split(',')
        .map(|item| item.trim().trim_matches(['"', '\'']))
        .filter(|item| !item.is_empty())
        .map(str::to_owned),
    );
    if done {
      collecting = false;
    }
  }
  items
}

/// Expand a workspace pattern (`crates/*`, `packages/**`, `src/sys`) into existing directories.
fn expand(root: &Path, pattern: &str, out: &mut Vec<String>) {
  let segments: Vec<&str> = pattern.split('/').filter(|s| !s.is_empty() && *s != ".").collect();
  let mut current = vec![String::new()];
  for segment in segments {
    let mut next = Vec::new();
    for base in &current {
      let dir = root.join(base);
      let join = |name: &str| if base.is_empty() { name.to_owned() } else { format!("{base}/{name}") };
      if segment == "**" {
        let mut stack = vec![base.clone()];
        while let Some(path) = stack.pop() {
          next.push(path.clone());
          for name in subdirectories(&root.join(&path)) {
            if !matches!(name.as_str(), "node_modules" | "target" | ".git") {
              stack.push(if path.is_empty() { name } else { format!("{path}/{name}") });
            }
          }
        }
      } else if segment.contains(['*', '?', '[']) {
        let Ok(glob) = globset::Glob::new(segment) else { continue };
        let matcher = glob.compile_matcher();
        next.extend(subdirectories(&dir).into_iter().filter(|n| matcher.is_match(n)).map(|n| join(&n)));
      } else if dir.join(segment).is_dir() {
        next.push(join(segment));
      }
    }
    current = next;
  }
  out.extend(current.into_iter().filter(|p| !p.is_empty()));
}

fn subdirectories(dir: &Path) -> Vec<String> {
  std::fs::read_dir(dir)
    .into_iter()
    .flatten()
    .flatten()
    .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
    .map(|e| e.file_name().to_string_lossy().into_owned())
    .collect()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn cargo_npm_and_pnpm_workspaces_are_expanded() {
    let root = tempfile::tempdir().unwrap();
    let r = root.path();
    let manifest = |dir: &str, file: &str| {
      std::fs::create_dir_all(r.join(dir)).unwrap();
      std::fs::write(r.join(dir).join(file), "{}").unwrap();
    };
    std::fs::write(
      r.join("Cargo.toml"),
      "[package]\nname = \"x\"\n[workspace]\nmembers = [\n  \"src/sys\", # comment\n  \"crates/*\",\n]\nexclude = [\"crates/skip\"]\n[workspace.dependencies]\nmembers = [\"nope\"]\n",
    )
    .unwrap();
    std::fs::write(r.join("package.json"), r#"{"workspaces":{"packages":["./packages/*","!packages/private"]}}"#).unwrap();
    std::fs::write(r.join("pnpm-workspace.yaml"), "packages:\n  - 'tools/**'\nother:\n  - nope\n").unwrap();
    manifest("src/sys", "Cargo.toml");
    manifest("crates/a", "Cargo.toml");
    manifest("crates/skip", "Cargo.toml");
    std::fs::create_dir_all(r.join("crates/empty")).unwrap();
    manifest("packages/web", "package.json");
    manifest("packages/private", "package.json");
    manifest("tools/deep/cli", "package.json");
    manifest("nope", "Cargo.toml");
    assert_eq!(
      declared_workspaces(r),
      ["crates/a", "packages/web", "src/sys", "tools/deep/cli"]
    );
  }
}
