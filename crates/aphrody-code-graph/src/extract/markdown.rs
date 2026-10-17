// SPDX-License-Identifier: Apache-2.0
//! Markdown extraction: the file, its headings (levels 1 to 3) and its links (`[[wiki]]` and
//! relative `[text](path.md)`), so a notes or memory folder becomes a navigable graph.

use super::{
    FileExtract, ImportKind, NodeClass, RawEdge, RawImport, RawNode,
    ids::{file_stem, make_id},
};
use crate::graph::Confidence;

fn wiki_links(line: &str, out: &mut Vec<String>) {
    let mut rest = line;
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else { break };
        let inner = &after[..end];
        let target = inner
            .split('|')
            .next()
            .unwrap_or("")
            .split('#')
            .next()
            .unwrap_or("")
            .trim();
        if !target.is_empty() {
            out.push(target.to_owned());
        }
        rest = &after[end + 2..];
    }
}

fn md_links(line: &str, out: &mut Vec<String>) {
    let mut rest = line;
    while let Some(start) = rest.find("](") {
        let after = &rest[start + 2..];
        let Some(end) = after.find(')') else { break };
        let target = after[..end].split_whitespace().next().unwrap_or("");
        let target = target.split('#').next().unwrap_or("");
        let external =
            target.contains("://") || target.starts_with("mailto:") || target.starts_with('/');
        if !target.is_empty() && !external && (target.ends_with(".md") || target.ends_with(".mdx"))
        {
            out.push(target.to_owned());
        }
        rest = &after[end + 1..];
    }
}

/// Extract one Markdown file.
#[must_use]
pub fn extract(rel_path: &str, source: &[u8]) -> FileExtract {
    let text = String::from_utf8_lossy(source);
    let file_id = make_id(&[rel_path]);
    let stem = file_stem(rel_path);
    let mut out = FileExtract::default();
    out.nodes.push(RawNode {
        id: file_id.clone(),
        label: rel_path.rsplit('/').next().unwrap_or(rel_path).to_owned(),
        file: rel_path.to_owned(),
        loc: "L1".into(),
        class: NodeClass::File,
    });
    let mut fenced = false;
    let mut seen = std::collections::HashSet::new();
    for (index, line) in text.lines().enumerate() {
        let loc = format!("L{}", index + 1);
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            continue;
        }
        let level = trimmed.chars().take_while(|c| *c == '#').count();
        if (1..=3).contains(&level) && trimmed[level..].starts_with(' ') {
            let title = trimmed[level..].trim().trim_end_matches('#').trim();
            if !title.is_empty() {
                let id = make_id(&[stem, "h", title]);
                if seen.insert(id.clone()) {
                    out.nodes.push(RawNode {
                        id: id.clone(),
                        label: title.to_owned(),
                        file: rel_path.to_owned(),
                        loc: loc.clone(),
                        class: NodeClass::Section,
                    });
                    out.edges.push(RawEdge {
                        src: file_id.clone(),
                        dst: id,
                        relation: "contains".into(),
                        confidence: Confidence::Extracted,
                        score: 1.0,
                        file: rel_path.to_owned(),
                        loc: loc.clone(),
                        context: Some("heading".into()),
                    });
                }
            }
        }
        let mut wiki = Vec::new();
        wiki_links(line, &mut wiki);
        for target in wiki {
            out.imports.push(RawImport {
                specifier: target,
                names: Vec::new(),
                loc: loc.clone(),
                kind: ImportKind::Wiki,
            });
        }
        let mut links = Vec::new();
        md_links(line, &mut links);
        for target in links {
            out.imports.push(RawImport {
                specifier: target,
                names: Vec::new(),
                loc: loc.clone(),
                kind: ImportKind::Link,
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headings_and_both_link_forms_are_extracted_outside_code_fences() {
        let src = "# Memory\n\n- [Build](bun-build.md) and [[bun-core-idioms|idioms]]\n- [web](https://x.dev/a.md)\n```\n# not a heading [[nope]]\n```\n## Next step\n";
        let f = extract("memory/MEMORY.md", src.as_bytes());
        let labels: Vec<&str> = f.nodes.iter().map(|n| n.label.as_str()).collect();
        assert_eq!(labels, ["MEMORY.md", "Memory", "Next step"]);
        let links: Vec<(&str, ImportKind)> = f
            .imports
            .iter()
            .map(|i| (i.specifier.as_str(), i.kind))
            .collect();
        assert_eq!(
            links,
            [
                ("bun-core-idioms", ImportKind::Wiki),
                ("bun-build.md", ImportKind::Link)
            ]
        );
    }
}
