// SPDX-License-Identifier: Apache-2.0
//! Bun documentation as an Aphrody OS subsystem.
//!
//! The corpus is the upstream Bun docs tree, supplied with `APHRODY_BUN_DOCS` or an optional
//! `third_party/bun/docs` checkout. It is indexed once, in memory, the first time a tool runs,
//! so every lookup is offline. The n2b registry
//! supplies the Node-to-Bun equivalents (`node:*` modules, npm packages, API call patterns).
//!
//! Tools: `bun_docs_search`, `bun_docs_read`, `bun_docs_list`, `bun_node_equivalent`.
//! Skill: `bun_docs_lookup` (search and return the best page in one call).
//!
//! The docs root resolves from `APHRODY_BUN_DOCS`, then an optional `third_party/bun/docs` in
//! the current directory or any ancestor, then the checkout this crate was built from.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use aphrody_n2b_registry::{APIS, MODULES, PACKAGES};
use aphrody_subsystem::{
    SkillManifest, SkillStep, SubsystemError, SystemSubsystem, ToolDefinition,
};
use async_trait::async_trait;
use serde_json::{Value, json};

/// Canonical site the vendored docs are published to.
pub const DOCS_BASE_URL: &str = "https://bun.com/docs";
/// Environment variable overriding the docs root.
pub const ROOT_ENV: &str = "APHRODY_BUN_DOCS";

const DEFAULT_LIMIT: usize = 8;
const MAX_LIMIT: usize = 50;
const DEFAULT_MAX_CHARS: usize = 24_000;
const SNIPPET_CHARS: usize = 240;

/// One documentation page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocPage {
    /// Path relative to the docs root, without extension, `/`-separated (`runtime/file-io`).
    pub slug: String,
    pub title: String,
    pub description: String,
    /// Markdown heading texts, in order.
    pub headings: Vec<String>,
    /// Page body without its front matter.
    pub body: String,
}

impl DocPage {
    /// Parse a page from its slug and raw `.md`/`.mdx` source.
    #[must_use]
    pub fn parse(slug: &str, source: &str) -> Self {
        let source = source.replace("\r\n", "\n");
        let (front, body) = split_front_matter(&source);
        let field = |key: &str| {
            front
                .lines()
                .find_map(|line| line.strip_prefix(key)?.strip_prefix(':'))
                .map(|value| value.trim().trim_matches(['"', '\'']).to_owned())
                .unwrap_or_default()
        };
        let headings = headings(body).map(|(_, text)| text.to_owned()).collect::<Vec<_>>();
        let mut title = field("title");
        if title.is_empty() {
            title = headings.first().cloned().unwrap_or_else(|| slug.to_owned());
        }
        Self {
            slug: slug.to_owned(),
            title,
            description: field("description"),
            headings,
            body: body.trim_start().to_owned(),
        }
    }

    /// Public URL of the page.
    #[must_use]
    pub fn url(&self) -> String {
        let slug = self.slug.strip_suffix("/index").unwrap_or(&self.slug);
        if slug == "index" { DOCS_BASE_URL.to_owned() } else { format!("{DOCS_BASE_URL}/{slug}") }
    }

    /// The body, or only the section whose heading contains `section` (case-insensitive):
    /// that heading down to the next heading of the same or a higher level.
    #[must_use]
    pub fn section(&self, section: &str) -> Option<&str> {
        let needle = section.to_lowercase();
        let mut start: Option<(usize, usize)> = None;
        let mut offset = 0;
        let mut in_code = false;
        for line in self.body.split_inclusive('\n') {
            if line.trim_start().starts_with("```") {
                in_code = !in_code;
            } else if !in_code && let Some((level, text)) = heading(line) {
                match start {
                    Some((from, open)) if level <= open => return Some(&self.body[from..offset]),
                    None if text.to_lowercase().contains(&needle) => start = Some((offset, level)),
                    _ => {},
                }
            }
            offset += line.len();
        }
        start.map(|(from, _)| &self.body[from..])
    }
}

fn split_front_matter(source: &str) -> (&str, &str) {
    if let Some(rest) = source.strip_prefix("---\n")
        && let Some(end) = rest.find("\n---")
    {
        let after = &rest[end + 4..];
        return (&rest[..end], after.strip_prefix('\n').unwrap_or(after));
    }
    ("", source)
}

fn heading(line: &str) -> Option<(usize, &str)> {
    let hashes = line.bytes().take_while(|byte| *byte == b'#').count();
    let text = line[hashes..].strip_prefix(' ')?;
    (1..=6).contains(&hashes).then(|| (hashes, text.trim()))
}

fn headings(body: &str) -> impl Iterator<Item = (usize, &str)> {
    let mut in_code = false;
    body.lines().filter_map(move |line| {
        if line.trim_start().starts_with("```") {
            in_code = !in_code;
            return None;
        }
        if in_code { None } else { heading(line) }
    })
}

fn terms(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|term| !term.is_empty())
        .map(str::to_lowercase)
        .collect()
}

fn count(haystack: &str, term: &str) -> usize {
    haystack.match_indices(term).count()
}

fn truncate(text: &str, max: usize) -> (&str, bool) {
    if text.len() <= max {
        return (text, false);
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (&text[..end], true)
}

/// A search result.
#[derive(Debug, Clone, PartialEq)]
pub struct Hit<'a> {
    pub page: &'a DocPage,
    pub score: f64,
    pub snippet: String,
}

/// The in-memory index of every page under a docs root.
#[derive(Debug, Clone, Default)]
pub struct DocsIndex {
    root: PathBuf,
    pages: Vec<DocPage>,
    lower: Vec<Lowered>,
}

#[derive(Debug, Clone, Default)]
struct Lowered {
    slug: String,
    title: String,
    description: String,
    headings: String,
    body: String,
}

impl DocsIndex {
    /// Index every `.md`/`.mdx` file under `root`.
    ///
    /// # Errors
    /// The root cannot be read, or it holds no page.
    pub fn load(root: &Path) -> Result<Self, String> {
        let mut files = Vec::new();
        collect(root, &mut files).map_err(|error| format!("{}: {error}", root.display()))?;
        let mut pages = Vec::with_capacity(files.len());
        for file in files {
            let source = std::fs::read_to_string(&file)
                .map_err(|error| format!("{}: {error}", file.display()))?;
            let relative = file.strip_prefix(root).unwrap_or(&file).with_extension("");
            let slug = relative
                .components()
                .map(|part| part.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            pages.push(DocPage::parse(&slug, &source));
        }
        if pages.is_empty() {
            return Err(format!("no Bun docs page under {}", root.display()));
        }
        Ok(Self::from_pages(root.to_path_buf(), pages))
    }

    /// Build an index from already parsed pages.
    #[must_use]
    pub fn from_pages(root: PathBuf, mut pages: Vec<DocPage>) -> Self {
        pages.sort_by(|a, b| a.slug.cmp(&b.slug));
        let lower = pages
            .iter()
            .map(|page| Lowered {
                slug: page.slug.to_lowercase(),
                title: page.title.to_lowercase(),
                description: page.description.to_lowercase(),
                headings: page.headings.join("\n").to_lowercase(),
                body: page.body.to_lowercase(),
            })
            .collect();
        Self { root, pages, lower }
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    #[must_use]
    pub fn pages(&self) -> &[DocPage] {
        &self.pages
    }

    /// Page by slug; also accepts a `bun.com/docs` URL, a leading `/` or a file extension.
    #[must_use]
    pub fn get(&self, slug: &str) -> Option<&DocPage> {
        let slug = slug.trim();
        let slug = slug
            .split_once("/docs/")
            .filter(|_| slug.contains("://"))
            .map_or(slug, |(_, rest)| rest);
        let slug = slug.trim_matches('/');
        let slug = slug.strip_suffix(".mdx").or_else(|| slug.strip_suffix(".md")).unwrap_or(slug);
        let slug = slug.split(['#', '?']).next().unwrap_or(slug);
        self.pages
            .iter()
            .find(|page| page.slug == slug)
            .or_else(|| self.pages.iter().find(|page| page.slug == format!("{slug}/index")))
    }

    /// Rank pages for `query`: title, slug, headings and description weigh more than the
    /// body, and rare terms (inverse document frequency) more than common ones.
    #[must_use]
    pub fn search(&self, query: &str, limit: usize) -> Vec<Hit<'_>> {
        let terms = terms(query);
        if terms.is_empty() {
            return Vec::new();
        }
        let total = self.pages.len() as f64;
        let idf: HashMap<&str, f64> = terms
            .iter()
            .map(|term| {
                let df = self.lower.iter().filter(|page| page.body.contains(term.as_str())).count();
                (term.as_str(), (1.0 + total / (1.0 + df as f64)).ln())
            })
            .collect();
        let phrase = query.trim().to_lowercase();
        let mut hits: Vec<Hit<'_>> = self
            .lower
            .iter()
            .zip(&self.pages)
            .filter_map(|(lower, page)| {
                let mut score = 0.0;
                let mut matched = 0;
                for term in &terms {
                    let fields = 8.0 * count(&lower.title, term) as f64
                        + 5.0 * count(&lower.slug, term) as f64
                        + 3.0 * count(&lower.headings, term) as f64
                        + 3.0 * count(&lower.description, term) as f64
                        + (1.0 + count(&lower.body, term) as f64).ln();
                    if fields > 0.0 {
                        matched += 1;
                        score += fields * idf[term.as_str()];
                    }
                }
                if matched == 0 {
                    return None;
                }
                // Pages covering every term beat pages repeating one of them.
                score *= f64::from(matched) / terms.len() as f64;
                if terms.len() > 1
                    && (lower.title.contains(&phrase) || lower.body.contains(&phrase))
                {
                    score *= 1.5;
                }
                Some(Hit { page, score, snippet: snippet(&page.body, &terms) })
            })
            .collect();
        hits.sort_by(|a, b| {
            b.score.total_cmp(&a.score).then_with(|| a.page.slug.cmp(&b.page.slug))
        });
        hits.truncate(limit);
        hits
    }
}

fn collect(dir: &Path, files: &mut Vec<PathBuf>) -> std::io::Result<()> {
    let mut entries = std::fs::read_dir(dir)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(std::fs::DirEntry::path);
    for entry in entries {
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            collect(&path, files)?;
        } else if matches!(path.extension().and_then(|e| e.to_str()), Some("md" | "mdx")) {
            files.push(path);
        }
    }
    Ok(())
}

fn snippet(body: &str, terms: &[String]) -> String {
    let line = body
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('<') && !line.starts_with("```"))
        .find(|line| {
            let lower = line.to_lowercase();
            terms.iter().any(|term| lower.contains(term.as_str()))
        })
        .unwrap_or_default();
    let (text, cut) = truncate(line, SNIPPET_CHARS);
    if cut { format!("{text}…") } else { text.to_owned() }
}

/// Docs root: `APHRODY_BUN_DOCS`, else an optional `third_party/bun/docs` in the current
/// directory or an ancestor, else the checkout this crate was built from.
#[must_use]
pub fn resolve_root() -> Option<PathBuf> {
    if let Some(root) = std::env::var_os(ROOT_ENV).map(PathBuf::from) {
        return Some(root);
    }
    let relative = Path::new("third_party").join("bun").join("docs");
    if let Ok(cwd) = std::env::current_dir()
        && let Some(found) = cwd.ancestors().map(|dir| dir.join(&relative)).find(|dir| dir.is_dir())
    {
        return Some(found);
    }
    let built = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(relative);
    built.is_dir().then_some(built)
}

/// Node modules, npm packages and Node API call patterns from the n2b registry that match
/// `query` (case-insensitive; a `node:` prefix is ignored), with their Bun equivalent.
#[must_use]
pub fn node_equivalents(query: &str, limit: usize) -> Vec<Value> {
    let needle = query.trim().to_lowercase();
    let needle = needle.strip_prefix("node:").unwrap_or(&needle).to_owned();
    if needle.is_empty() {
        return Vec::new();
    }
    let module_name = |module: &str| module.strip_prefix("node:").unwrap_or(module).to_lowercase();
    let mut out = Vec::new();
    let mut modules = MODULES
        .iter()
        .filter(|entry| module_name(&entry.module).contains(&needle))
        .collect::<Vec<_>>();
    // An exact module (`fs`) before its sub-paths (`fs/promises`).
    modules.sort_by_key(|entry| module_name(&entry.module) != needle);
    out.extend(modules.into_iter().map(|entry| {
        json!({
            "kind": "module",
            "id": entry.id,
            "node": entry.module,
            "compat": format!("{:?}", entry.compat).to_lowercase(),
            "bun": entry.equivalent,
            "missing_apis": entry.missing_apis,
            "hint": entry.rewrite_hint,
            "notes": entry.docs,
        })
    }));
    out.extend(PACKAGES.iter().filter(|entry| entry.package.to_lowercase().contains(&needle)).map(
        |entry| {
            json!({
                "kind": "package",
                "id": entry.id,
                "node": entry.package,
                "bun": entry.replacement,
                "strategy": entry.strategy.map(|s| format!("{s:?}").to_lowercase()),
                "apis": entry.apis,
                "hint": entry.note,
                "notes": entry.docs,
            })
        },
    ));
    out.extend(
        APIS.iter()
            .filter(|entry| {
                entry.id.to_lowercase().contains(&needle)
                    || entry.message.to_lowercase().contains(&needle)
            })
            .map(|entry| {
                json!({
                    "kind": "api",
                    "id": entry.id,
                    "node": entry.pattern,
                    "bun": entry.replacement,
                    "import_from": entry.import_from,
                    "hint": entry.message,
                })
            }),
    );
    out.truncate(limit);
    out
}

/// The `bun_docs` subsystem.
#[derive(Debug, Default)]
pub struct BunDocsSubsystem {
    root: Option<PathBuf>,
    index: OnceLock<Result<DocsIndex, String>>,
}

impl BunDocsSubsystem {
    /// A subsystem whose docs root is resolved by [`resolve_root`] on first use.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// A subsystem reading an explicit docs root.
    #[must_use]
    pub fn with_root(root: impl Into<PathBuf>) -> Self {
        Self { root: Some(root.into()), index: OnceLock::new() }
    }

    /// The index, built on first call.
    ///
    /// # Errors
    /// [`SubsystemError::Unavailable`] when no docs root is found or it cannot be read.
    pub fn index(&self) -> Result<&DocsIndex, SubsystemError> {
        self.index
            .get_or_init(|| {
                let root = self.root.clone().or_else(resolve_root).ok_or_else(|| {
                    format!("Bun docs not found: set {ROOT_ENV} to an upstream Bun docs directory")
                })?;
                DocsIndex::load(&root)
            })
            .as_ref()
            .map_err(|error| SubsystemError::Unavailable(error.clone()))
    }
}

fn text_arg<'a>(arguments: &'a Value, key: &str) -> Result<&'a str, SubsystemError> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| SubsystemError::InvalidArguments(format!("`{key}` is required")))
}

fn usize_arg(arguments: &Value, key: &str, default: usize, max: usize) -> usize {
    arguments
        .get(key)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(default)
        .clamp(1, max)
}

fn page_content(
    page: &DocPage,
    section: Option<&str>,
    max_chars: usize,
) -> Result<Value, SubsystemError> {
    let content = match section {
        Some(section) => page.section(section).ok_or_else(|| {
            SubsystemError::InvalidArguments(format!(
                "no section matching `{section}` in {}; headings: {}",
                page.slug,
                page.headings.join(" | ")
            ))
        })?,
        None => page.body.as_str(),
    };
    let (content, truncated) = truncate(content, max_chars);
    Ok(json!({
        "slug": page.slug,
        "title": page.title,
        "description": page.description,
        "url": page.url(),
        "headings": page.headings,
        "content": content,
        "truncated": truncated,
    }))
}

#[async_trait]
impl SystemSubsystem for BunDocsSubsystem {
    fn name(&self) -> &str {
        "bun_docs"
    }

    fn description(&self) -> &str {
        "Offline Bun documentation (vendored third_party/bun/docs) and n2b Node-to-Bun equivalents."
    }

    fn tools(&self) -> Vec<ToolDefinition> {
        vec![
            ToolDefinition::new(
                "bun_docs_search",
                "Search the vendored Bun docs (runtime, bundler, package manager, test runner, guides). Returns ranked pages with slug, url and a snippet; set include_content to also return the best page.",
                json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "Words or an API name, e.g. `Bun.file stream` or `bun test snapshot`." },
                        "limit": { "type": "integer", "minimum": 1, "maximum": MAX_LIMIT, "default": DEFAULT_LIMIT },
                        "include_content": { "type": "boolean", "default": false, "description": "Also return the Markdown of the top hit." },
                        "max_chars": { "type": "integer", "minimum": 1, "default": DEFAULT_MAX_CHARS }
                    },
                    "required": ["query"]
                }),
            )
            .read_only(),
            ToolDefinition::new(
                "bun_docs_read",
                "Read one Bun docs page as Markdown by slug (`runtime/file-io`) or bun.com/docs URL, optionally only the section under a heading.",
                json!({
                    "type": "object",
                    "properties": {
                        "slug": { "type": "string" },
                        "section": { "type": "string", "description": "Case-insensitive heading substring." },
                        "max_chars": { "type": "integer", "minimum": 1, "default": DEFAULT_MAX_CHARS }
                    },
                    "required": ["slug"]
                }),
            )
            .read_only(),
            ToolDefinition::new(
                "bun_docs_list",
                "List Bun docs pages (slug, title, description, url), optionally under a slug prefix such as `runtime/` or `guides/test/`.",
                json!({
                    "type": "object",
                    "properties": { "prefix": { "type": "string" } }
                }),
            )
            .read_only(),
            ToolDefinition::new(
                "bun_node_equivalent",
                "Bun equivalent of a Node module (`fs`, `node:child_process`), npm package (`dotenv`, `jest`) or Node API, from the n2b registry, with matching Bun docs pages.",
                json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string" },
                        "limit": { "type": "integer", "minimum": 1, "maximum": MAX_LIMIT, "default": DEFAULT_LIMIT }
                    },
                    "required": ["query"]
                }),
            )
            .read_only(),
        ]
    }

    async fn call(&self, tool: &str, arguments: Value) -> Result<Value, SubsystemError> {
        match tool {
            "bun_docs_search" => {
                let index = self.index()?;
                let query = text_arg(&arguments, "query")?;
                let limit = usize_arg(&arguments, "limit", DEFAULT_LIMIT, MAX_LIMIT);
                let max_chars = usize_arg(&arguments, "max_chars", DEFAULT_MAX_CHARS, usize::MAX);
                let hits = index.search(query, limit);
                let top = match hits.first() {
                    Some(hit)
                        if arguments.get("include_content").and_then(Value::as_bool)
                            == Some(true) =>
                    {
                        Some(page_content(hit.page, None, max_chars)?)
                    },
                    _ => None,
                };
                Ok(json!({
                    "query": query,
                    "results": hits.iter().map(|hit| json!({
                        "slug": hit.page.slug,
                        "title": hit.page.title,
                        "description": hit.page.description,
                        "url": hit.page.url(),
                        "score": (hit.score * 100.0).round() / 100.0,
                        "snippet": hit.snippet,
                    })).collect::<Vec<_>>(),
                    "top": top,
                }))
            },
            "bun_docs_read" => {
                let index = self.index()?;
                let slug = text_arg(&arguments, "slug")?;
                let page = index.get(slug).ok_or_else(|| {
                    let near = index
                        .search(slug, 5)
                        .iter()
                        .map(|hit| hit.page.slug.clone())
                        .collect::<Vec<_>>();
                    SubsystemError::InvalidArguments(format!(
                        "no Bun docs page `{slug}`; closest: {}",
                        near.join(", ")
                    ))
                })?;
                let section = arguments
                    .get("section")
                    .and_then(Value::as_str)
                    .filter(|s| !s.trim().is_empty());
                page_content(
                    page,
                    section,
                    usize_arg(&arguments, "max_chars", DEFAULT_MAX_CHARS, usize::MAX),
                )
            },
            "bun_docs_list" => {
                let index = self.index()?;
                let prefix = arguments
                    .get("prefix")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim_start_matches('/');
                let pages = index
                    .pages()
                    .iter()
                    .filter(|page| page.slug.starts_with(prefix))
                    .map(|page| json!({ "slug": page.slug, "title": page.title, "description": page.description, "url": page.url() }))
                    .collect::<Vec<_>>();
                Ok(
                    json!({ "root": index.root().display().to_string(), "count": pages.len(), "pages": pages }),
                )
            },
            "bun_node_equivalent" => {
                let query = text_arg(&arguments, "query")?;
                let limit = usize_arg(&arguments, "limit", DEFAULT_LIMIT, MAX_LIMIT);
                let equivalents = node_equivalents(query, limit);
                // Docs are a bonus here: the registry answer stands without the submodule.
                let docs = self.index().map_or_else(
                    |_| Vec::new(),
                    |index| {
                        let bare = query.trim().trim_start_matches("node:");
                        index
                            .search(&format!("node {bare}"), 3)
                            .iter()
                            .map(|hit| json!({ "slug": hit.page.slug, "title": hit.page.title, "url": hit.page.url() }))
                            .collect()
                    },
                );
                Ok(json!({ "query": query, "equivalents": equivalents, "docs": docs }))
            },
            other => Err(SubsystemError::UnknownTool(other.to_owned())),
        }
    }

    fn skills(&self) -> Vec<SkillManifest> {
        vec![SkillManifest {
            name: "bun_docs_lookup".into(),
            description: "Answer a Bun question from the vendored docs: ranked pages plus the \
                          best page's Markdown."
                .into(),
            parameters: vec!["query".into()],
            steps: vec![SkillStep {
                tool: "bun_docs_search".into(),
                arguments: json!({ "query": "{{query}}", "limit": 5, "include_content": true }),
            }],
        }]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: &str = "---\r\ntitle: File I/O\r\ndescription: \"Read and write \
                        files.\"\r\n---\r\n\r\nIntro about Bun.file.\r\n\r\n## Reading \
                        files\r\n\r\nUse `Bun.file(path)`.\r\n\r\n```ts\r\n# not a \
                        heading\r\n```\r\n\r\n### Streams\r\n\r\nStream it.\r\n\r\n## Writing \
                        files\r\n\r\nUse `Bun.write`.\r\n";

    fn fixture() -> DocsIndex {
        DocsIndex::from_pages(
            PathBuf::from("docs"),
            vec![
                DocPage::parse("runtime/file-io", PAGE),
                DocPage::parse(
                    "test/snapshots",
                    "---\ntitle: Snapshots\n---\n\n`bun test` supports snapshot testing with \
                 toMatchSnapshot.\n",
                ),
                DocPage::parse("index", "# Welcome\n\nBun is a runtime.\n"),
            ],
        )
    }

    #[test]
    fn front_matter_headings_and_code_fences() {
        let page = DocPage::parse("runtime/file-io", PAGE);
        assert_eq!(page.title, "File I/O");
        assert_eq!(page.description, "Read and write files.");
        assert_eq!(page.headings, ["Reading files", "Streams", "Writing files"]);
        assert!(page.body.starts_with("Intro"));
        assert_eq!(page.url(), "https://bun.com/docs/runtime/file-io");
        assert_eq!(fixture().get("index").map(DocPage::url).as_deref(), Some(DOCS_BASE_URL));
        assert_eq!(fixture().get("index").map(|p| p.title.as_str()), Some("Welcome"));
    }

    #[test]
    fn section_stops_at_the_next_sibling_heading() {
        let page = DocPage::parse("runtime/file-io", PAGE);
        let reading = page.section("reading").expect("section");
        assert!(reading.contains("Streams") && reading.contains("# not a heading"));
        assert!(!reading.contains("Writing files"));
        assert!(page.section("writing").expect("last").contains("Bun.write"));
        assert!(page.section("nope").is_none());
    }

    #[test]
    fn search_ranks_title_matches_and_ignores_misses() {
        let index = fixture();
        let hits = index.search("snapshot testing", 5);
        assert_eq!(hits[0].page.slug, "test/snapshots");
        assert!(hits[0].snippet.contains("toMatchSnapshot"));
        assert_eq!(index.search("Bun.file", 1)[0].page.slug, "runtime/file-io");
        assert!(index.search("zzzz", 5).is_empty());
        assert!(index.search("  ", 5).is_empty());
    }

    #[test]
    fn get_accepts_urls_extensions_and_anchors() {
        let index = fixture();
        for key in [
            "runtime/file-io",
            "/runtime/file-io.mdx",
            "https://bun.com/docs/runtime/file-io#streams",
        ] {
            assert_eq!(index.get(key).map(|p| p.slug.as_str()), Some("runtime/file-io"), "{key}");
        }
        assert!(index.get("runtime/nope").is_none());
    }

    #[test]
    fn registry_equivalents_cover_modules_and_packages() {
        let fs = node_equivalents("node:fs", 50);
        assert!(!fs.is_empty());
        assert_eq!(fs[0]["kind"], "module");
        assert!(node_equivalents("dotenv", 10).iter().any(|e| e["kind"] == "package"));
        assert!(node_equivalents("", 10).is_empty());
    }

    #[tokio::test]
    async fn vendored_corpus_answers_real_queries() {
        let Some(root) = resolve_root() else {
            eprintln!("third_party/bun/docs not checked out; skipping");
            return;
        };
        let docs = BunDocsSubsystem::with_root(root);
        let found = docs
            .call("bun_docs_search", json!({"query": "Bun.file write", "include_content": true}))
            .await
            .expect("search");
        let slugs: Vec<&str> = found["results"]
            .as_array()
            .expect("results")
            .iter()
            .filter_map(|r| r["slug"].as_str())
            .collect();
        assert!(slugs.contains(&"runtime/file-io"), "{slugs:?}");
        assert!(found["top"]["content"].as_str().is_some_and(|c| !c.is_empty()));
        let read = docs
            .call("bun_docs_read", json!({"slug": "runtime/file-io", "section": "Writing files"}))
            .await
            .expect("read");
        assert!(read["content"].as_str().expect("content").contains("Bun.write"));
        let list = docs.call("bun_docs_list", json!({"prefix": "runtime/"})).await.expect("list");
        assert!(list["count"].as_u64().expect("count") > 20);
        let eq =
            docs.call("bun_node_equivalent", json!({"query": "child_process"})).await.expect("eq");
        assert!(!eq["equivalents"].as_array().expect("eq").is_empty());
        let err =
            docs.call("bun_docs_read", json!({"slug": "runtime/nope"})).await.expect_err("missing");
        assert!(matches!(err, SubsystemError::InvalidArguments(_)));
    }

    #[test]
    fn skill_targets_a_published_tool() {
        let docs = BunDocsSubsystem::new();
        let tools = docs.tools();
        assert_eq!(tools.len(), 4);
        assert!(tools.iter().all(|tool| tool.read_only && tool.name.starts_with("bun_")));
        for skill in docs.skills() {
            assert!(skill.steps.iter().all(|step| tools.iter().any(|t| t.name == step.tool)));
        }
    }
}
