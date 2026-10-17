// SPDX-License-Identifier: Apache-2.0
//! Document search over the WebOS file system: source-aware chunking from `aphrody-rag-core`
//! and BM25 ranking. There is no embedding model in the browser, so the ranking is lexical;
//! results carry the file, the line range and the chunk text, like the native RAG.

use std::collections::{HashMap, HashSet};

use aphrody_google::language_detect::detect_single_local;
use aphrody_rag_core::{ChunkOptions, chunker_for_path};
use aphrody_shell_vfs::{FileKind, Vfs, path as vpath};
use serde_json::{Value, json};

const MAX_FILE_BYTES: u64 = 1 << 20;
const MAX_FILES: usize = 2000;
const K1: f64 = 1.2;
const B: f64 = 0.75;

struct Doc {
    path: String,
    start_line: u32,
    end_line: u32,
    text: String,
    terms: HashMap<String, u32>,
    len: usize,
}

fn tokens(text: &str) -> impl Iterator<Item = String> + '_ {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(str::to_lowercase)
}

fn collect(fs: &mut impl Vfs, root: &str) -> Vec<Doc> {
    let mut docs = Vec::new();
    let (mut stack, mut files) = (vec![root.to_owned()], 0usize);
    let opts = ChunkOptions::default();
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs.read_dir(dir.as_bytes()) else {
            continue;
        };
        for entry in entries {
            let Ok(child) = String::from_utf8(vpath::join(dir.as_bytes(), &entry.name)) else {
                continue;
            };
            match entry.kind {
                FileKind::Dir => stack.push(child),
                FileKind::File if files < MAX_FILES => {
                    if fs
                        .stat(child.as_bytes())
                        .is_ok_and(|s| s.size <= MAX_FILE_BYTES)
                        && let Ok(bytes) = fs.read(child.as_bytes())
                        && let Ok(source) = String::from_utf8(bytes)
                    {
                        files += 1;
                        for chunk in chunker_for_path(&child).chunk(&child, &source, &opts) {
                            let mut terms = HashMap::new();
                            let mut len = 0;
                            for t in tokens(&chunk.text) {
                                *terms.entry(t).or_insert(0) += 1;
                                len += 1;
                            }
                            docs.push(Doc {
                                path: child.clone(),
                                start_line: chunk.start_line,
                                end_line: chunk.end_line,
                                text: chunk.text,
                                terms,
                                len,
                            });
                        }
                    }
                }
                FileKind::File => {}
            }
        }
    }
    docs
}

/// `{"documents","chunks"}` over everything under `root`.
pub fn stats(fs: &mut impl Vfs, root: &str) -> Value {
    let docs = collect(fs, root);
    let files: HashSet<&str> = docs.iter().map(|d| d.path.as_str()).collect();
    json!({ "documents": files.len(), "chunks": docs.len() })
}

/// BM25 top-`limit` chunks for `query`:
/// `{"results":[{path,start_line,end_line,score,content,language}]}`, `language` being the ISO
/// 639-1 code `aphrody-google` detects locally for the chunk.
pub fn search(fs: &mut impl Vfs, root: &str, query: &str, limit: usize) -> Value {
    let docs = collect(fs, root);
    let query_terms: Vec<String> = tokens(query).collect::<HashSet<_>>().into_iter().collect();
    if docs.is_empty() || query_terms.is_empty() {
        return json!({ "results": [] });
    }
    let n = docs.len() as f64;
    let avg = docs.iter().map(|d| d.len as f64).sum::<f64>() / n;
    let idf: HashMap<&str, f64> = query_terms
        .iter()
        .map(|t| {
            let df = docs.iter().filter(|d| d.terms.contains_key(t)).count() as f64;
            (t.as_str(), ((n - df + 0.5) / (df + 0.5) + 1.0).ln())
        })
        .collect();
    let mut scored: Vec<(f64, &Doc)> = docs
        .iter()
        .filter_map(|d| {
            let score: f64 = query_terms
                .iter()
                .filter_map(|t| {
                    let f = f64::from(*d.terms.get(t)?);
                    let norm = f + K1 * (1.0 - B + B * d.len as f64 / avg.max(1.0));
                    Some(idf[t.as_str()] * f * (K1 + 1.0) / norm)
                })
                .sum();
            (score > 0.0).then_some((score, d))
        })
        .collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.path.cmp(&b.1.path)));
    let results: Vec<Value> = scored
        .into_iter()
        .take(limit)
        .map(|(score, d)| {
            json!({
                "path": d.path, "start_line": d.start_line, "end_line": d.end_line,
                "score": score, "content": d.text,
                "language": detect_single_local(&d.text).language,
            })
        })
        .collect();
    json!({ "results": results })
}

#[cfg(test)]
mod tests {
    use super::*;
    use aphrody_shell_web::opfs::OpfsVfs;

    #[test]
    fn ranks_the_relevant_file_first() {
        let mut fs = OpfsVfs::new();
        fs.mkdir_all(b"/home/user").expect("mkdir");
        fs.write(
            b"/home/user/cats.md",
            b"# Cats\n\nCats purr and sleep all day long.\n",
        )
        .expect("w");
        fs.write(
            b"/home/user/dogs.md",
            b"# Dogs\n\nDogs bark at the mailman every morning.\n",
        )
        .expect("w");
        fs.write(b"/home/user/bin.dat", &[0xff, 0xfe, 0x00])
            .expect("w");
        let hits = search(&mut fs, "/home/user", "purr", 5);
        let first = &hits["results"][0];
        assert_eq!(first["path"], "/home/user/cats.md");
        assert!(first["content"].as_str().expect("content").contains("purr"));
        assert_eq!(first["language"], "en");
        assert_eq!(hits["results"].as_array().expect("array").len(), 1);
        let s = stats(&mut fs, "/home/user");
        assert_eq!(s["documents"], 2);
        assert!(
            search(&mut fs, "/home/user", "zzzz", 5)["results"]
                .as_array()
                .expect("a")
                .is_empty()
        );
    }
}
