// SPDX-License-Identifier: Apache-2.0
//! Native counterpart of apps/web/src/templates/templates-source.ts.
//! Repository root is explicit; no machine paths, provider stores or directory links.

use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::{self, Read},
    path::{Component, Path},
};

const MAX_FILE_BYTES: usize = 64 * 1024;
const MAX_STACK_BYTES: usize = 1024 * 1024;
const MAX_ENTRIES: usize = 10_000;
const MAX_CATALOG_BYTES: usize = 32 * 1024 * 1024;
const MAX_DEPTH: usize = 64;

#[derive(Debug, Serialize)]
pub struct TemplateFile {
    pub name: String,
    pub path: String,
    pub language: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDefinition {
    pub id: String,
    pub name: String,
    pub tagline: String,
    pub description: String,
    pub tags: Vec<String>,
    pub cli_command: String,
    pub dependencies: BTreeMap<String, String>,
    pub files: Vec<TemplateFile>,
}

#[derive(Deserialize)]
struct StackTemplate {
    path: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    required: bool,
    exclusive: Option<String>,
    curated: Option<String>,
    #[serde(default)]
    dependencies: BTreeMap<String, String>,
    #[serde(default)]
    dev_dependencies: BTreeMap<String, String>,
}

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

/// Require regular path components beneath the configured repository. Symlinks,
/// including links back inside the tree, are excluded from the catalog contract.
fn checked_path(root: &Path, relative: &Path) -> io::Result<std::path::PathBuf> {
    let mut path = root.to_owned();
    for component in relative.components() {
        let Component::Normal(part) = component else {
            return Err(invalid("invalid template path"));
        };
        path.push(part);
        if fs::symlink_metadata(&path)?.file_type().is_symlink() {
            return Err(invalid("template symlink denied"));
        }
    }
    if !path.canonicalize()?.starts_with(root) {
        return Err(invalid("template path escapes root"));
    }
    Ok(path)
}

fn read_bounded(path: &Path, maximum: usize) -> io::Result<Option<String>> {
    let file = fs::File::open(path)?;
    if !file.metadata()?.is_file() {
        return Err(invalid("template is not a regular file"));
    }
    let mut bytes = Vec::new();
    file.take((maximum + 1) as u64).read_to_end(&mut bytes)?;
    if bytes.len() > maximum {
        return Ok(None);
    }
    Ok(Some(String::from_utf8(bytes).map_err(|_| invalid("template text is not UTF-8"))?))
}

fn language(name: &str) -> Option<&'static str> {
    if matches!(name, "Dockerfile" | "gitignore") {
        return Some("text");
    }
    match Path::new(name).extension()?.to_str()? {
        "ts" => Some("typescript"),
        "tsx" => Some("tsx"),
        "js" => Some("javascript"),
        "json" => Some("json"),
        "toml" => Some("toml"),
        "md" => Some("markdown"),
        "css" => Some("css"),
        "html" => Some("html"),
        "rs" => Some("rust"),
        "xml" => Some("xml"),
        _ => None,
    }
}

struct Budget {
    entries: usize,
    bytes: usize,
}

fn read_files(root: &Path, directory: &Path, budget: &mut Budget) -> io::Result<Vec<TemplateFile>> {
    let mut files = Vec::new();
    let mut pending = vec![(directory.to_owned(), 0usize)];
    while let Some((current, depth)) = pending.pop() {
        if depth > MAX_DEPTH {
            return Err(invalid("template nesting limit exceeded"));
        }
        for entry in fs::read_dir(&current)? {
            let entry = entry?;
            budget.entries += 1;
            if budget.entries > MAX_ENTRIES {
                return Err(invalid("template entry limit exceeded"));
            }
            let entry_path = entry.path();
            let path = checked_path(
                root,
                entry_path.strip_prefix(root).map_err(|_| invalid("invalid template root"))?,
            )?;
            let kind = fs::symlink_metadata(&path)?.file_type();
            if kind.is_dir() {
                pending.push((path, depth + 1));
                continue;
            }
            if !kind.is_file() {
                return Err(invalid("special template file denied"));
            }
            let name = entry
                .file_name()
                .to_str()
                .ok_or_else(|| invalid("template name is not UTF-8"))?
                .to_owned();
            let Some(language) = language(&name) else {
                continue;
            };
            let Some(content) = read_bounded(&path, MAX_FILE_BYTES)? else {
                continue;
            };
            budget.bytes += content.len();
            if budget.bytes > MAX_CATALOG_BYTES {
                return Err(invalid("template catalog size limit exceeded"));
            }
            let relative =
                path.strip_prefix(directory).map_err(|_| invalid("invalid template file"))?;
            let relative = relative
                .to_str()
                .ok_or_else(|| invalid("template path is not UTF-8"))?
                .replace('\\', "/");
            files.push(TemplateFile {
                name,
                path: relative,
                language: language.to_owned(),
                content,
            });
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

/// Load exactly the declared template catalog. Paths are confined to m3/templates;
/// each text file is capped at 64KiB, the catalog at 32MiB and 10,000 entries.
/// The host must keep the configured source tree immutable during loading; path
/// checks do not claim protection against concurrent adversarial directory swaps.
pub fn load_templates(root: &Path) -> io::Result<Vec<TemplateDefinition>> {
    let root = root.canonicalize()?;
    let manifest = checked_path(&root, Path::new("m3/templates/stack.toml"))?;
    let source = read_bounded(&manifest, MAX_STACK_BYTES)?
        .ok_or_else(|| invalid("stack manifest size limit exceeded"))?;
    let stack: toml::Value =
        toml::from_str(&source).map_err(|_| invalid("invalid stack manifest TOML"))?;
    let Some(table) = stack.get("template") else {
        return Ok(Vec::new());
    };
    let table = table.as_table().ok_or_else(|| invalid("template catalog must be a table"))?;
    let mut templates = Vec::new();
    let mut budget = Budget { entries: 0, bytes: 0 };
    for (id, value) in table {
        let template: StackTemplate =
            value.clone().try_into().map_err(|_| invalid("invalid template declaration"))?;
        let relative = Path::new(&template.path);
        if !relative.starts_with("m3/templates") {
            return Err(invalid("template outside m3/templates denied"));
        }
        let directory = checked_path(&root, relative)?;
        let mut tags = Vec::new();
        if template.required {
            tags.push("required".to_owned());
        }
        if let Some(exclusive) = template.exclusive.as_ref().filter(|s| !s.is_empty()) {
            tags.push(format!("exclusive: {exclusive}"));
        }
        if let Some(curated) = template.curated.as_ref().filter(|s| !s.is_empty()) {
            tags.push(curated.clone());
        }
        let cli_command = if template.required {
            "just yolo::create ../my-app".to_owned()
        } else if template.exclusive.as_deref() == Some("framework") {
            format!("just yolo::create ../my-app --framework {id}")
        } else {
            format!("just yolo::create ../my-app --with {id}")
        };
        let mut dependencies = template.dependencies;
        dependencies.extend(template.dev_dependencies);
        templates.push(TemplateDefinition {
            id: id.clone(),
            name: id.clone(),
            tagline: template.description,
            description: format!("{} in m3/templates/stack.toml", template.path),
            tags,
            cli_command,
            dependencies,
            files: read_files(&root, &directory, &mut budget)?,
        });
    }
    Ok(templates)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> io::Result<tempfile::TempDir> {
        let root = tempfile::tempdir()?;
        fs::create_dir_all(root.path().join("m3/templates/base/src"))?;
        fs::create_dir_all(root.path().join("m3/templates/hono"))?;
        fs::create_dir_all(root.path().join("m3/templates/web"))?;
        fs::write(
            root.path().join("m3/templates/stack.toml"),
            "[template.base]\npath='m3/templates/base'\ndescription='Base server'\nrequired=true\ndependencies={a='1'}\ndev_dependencies={a='2',b='3'}\n[template.hono]\npath='m3/templates/hono'\nexclusive='framework'\n[template.web]\npath='m3/templates/web'\ncurated='default'\n",
        )?;
        fs::write(root.path().join("m3/templates/base/src/server.ts"), "export {};\n")?;
        fs::write(root.path().join("m3/templates/base/Dockerfile"), "FROM scratch\n")?;
        fs::write(root.path().join("m3/templates/base/big.json"), vec![b'x'; MAX_FILE_BYTES + 1])?;
        fs::write(root.path().join("m3/templates/base/logo.png"), b"binary")?;
        Ok(root)
    }

    #[test]
    fn preserves_catalog_shapes_commands_and_limits() -> io::Result<()> {
        let root = fixture()?;
        let templates = load_templates(root.path())?;
        assert_eq!(
            templates.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            ["base", "hono", "web"]
        );
        assert_eq!(templates[0].cli_command, "just yolo::create ../my-app");
        assert_eq!(templates[1].cli_command, "just yolo::create ../my-app --framework hono");
        assert_eq!(templates[2].cli_command, "just yolo::create ../my-app --with web");
        assert_eq!(templates[0].dependencies["a"], "2");
        assert_eq!(templates[0].tags, ["required"]);
        assert_eq!(templates[1].tags, ["exclusive: framework"]);
        assert_eq!(templates[2].tags, ["default"]);
        assert_eq!(
            templates[0].files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(),
            ["Dockerfile", "src/server.ts"]
        );
        assert_eq!(templates[0].files[1].language, "typescript");
        assert_eq!(
            serde_json::to_value(&templates[0])?["cliCommand"],
            "just yolo::create ../my-app"
        );
        Ok(())
    }

    #[test]
    fn traversal_and_external_template_paths_are_rejected() -> io::Result<()> {
        let root = fixture()?;
        for path in ["m3/templates/../secret", "../secret", "/secret", "crates/ai"] {
            fs::write(
                root.path().join("m3/templates/stack.toml"),
                format!("[template.bad]\npath='{path}'\n"),
            )?;
            assert!(load_templates(root.path()).is_err());
        }
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn symlink_to_protected_file_is_rejected() -> io::Result<()> {
        let root = fixture()?;
        fs::write(root.path().join("secret.ts"), "protected")?;
        std::os::unix::fs::symlink(
            root.path().join("secret.ts"),
            root.path().join("m3/templates/base/secret.ts"),
        )?;
        assert!(load_templates(root.path()).is_err());
        Ok(())
    }
}
