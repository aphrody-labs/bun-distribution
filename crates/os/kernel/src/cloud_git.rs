// SPDX-License-Identifier: Apache-2.0
//! In-process Git inspection for the `cloud` subsystem, built on `gix` (no `git` subprocess).

use std::path::Path;

use aphrody_subsystem::SubsystemError;
use serde_json::{Value, json};

fn failed(context: &str, error: impl std::fmt::Display) -> SubsystemError {
    SubsystemError::Failed(format!("{context}: {error}"))
}

fn open(path: &Path) -> Result<gix::Repository, SubsystemError> {
    gix::discover(path).map_err(|e| failed("failed to open git repository", e))
}

fn short_ref(name: &str) -> String {
    name.strip_prefix("refs/heads/")
        .or_else(|| name.strip_prefix("refs/remotes/"))
        .unwrap_or(name)
        .to_owned()
}

fn relative_age(seconds: i64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX));
    let delta = (now - seconds).max(0);
    let (value, unit) = match delta {
        d if d < 60 => (d, "second"),
        d if d < 3_600 => (d / 60, "minute"),
        d if d < 86_400 => (d / 3_600, "hour"),
        d if d < 86_400 * 30 => (d / 86_400, "day"),
        d if d < 86_400 * 365 => (d / (86_400 * 30), "month"),
        d => (d / (86_400 * 365), "year"),
    };
    let plural = if value == 1 { "" } else { "s" };
    format!("{value} {unit}{plural} ago")
}

fn commit_subject(repo: &gix::Repository, id: gix::ObjectId) -> String {
    repo.find_commit(id)
        .ok()
        .and_then(|commit| commit.message().ok().map(|m| m.title.to_string()))
        .map(|s| s.trim().to_owned())
        .unwrap_or_default()
}

/// Branch line in the `git status -b` style: `main...origin/main`, or `HEAD (no branch)`.
fn branch_line(repo: &gix::Repository) -> Result<String, SubsystemError> {
    let head = repo.head().map_err(|e| failed("failed to read HEAD", e))?;
    let Some(name) = head.referent_name() else {
        return Ok("HEAD (no branch)".to_owned());
    };
    let short = short_ref(&name.as_bstr().to_string());
    let mut line = if head.is_unborn() { format!("No commits yet on {short}") } else { short };
    if let Some(Ok(upstream)) =
        repo.branch_remote_tracking_ref_name(name, gix::remote::Direction::Fetch)
    {
        line.push_str("...");
        line.push_str(&short_ref(&upstream.as_bstr().to_string()));
    }
    Ok(line)
}

/// `github_status`: branch, porcelain-like change lists and the last five commits.
pub(crate) fn status(path: &Path) -> Result<Value, SubsystemError> {
    let repo = open(path)?;
    let branch = branch_line(&repo)?;
    let mut modified = Vec::new();
    let mut untracked = Vec::new();

    if repo.workdir().is_some() {
        let items = repo
            .status(gix::progress::Discard)
            .map_err(|e| failed("git status failed", e))?
            .untracked_files(gix::status::UntrackedFiles::Files)
            .into_iter(Vec::<gix::bstr::BString>::new())
            .map_err(|e| failed("git status failed", e))?;
        for item in items {
            let item = item.map_err(|e| failed("git status failed", e))?;
            let location = item.location().to_string();
            match &item {
                gix::status::Item::IndexWorktree(change) => {
                    use gix::status::index_worktree::iter::Summary;
                    let code = match change.summary() {
                        Some(Summary::Added) => {
                            untracked.push(location);
                            continue;
                        },
                        Some(Summary::Removed) => "D",
                        Some(Summary::Modified) => "M",
                        Some(Summary::TypeChange) => "T",
                        Some(Summary::Renamed) => "R",
                        Some(Summary::Copied) => "C",
                        Some(Summary::IntentToAdd) => "A",
                        Some(Summary::Conflict) => "U",
                        None => continue,
                    };
                    modified.push(format!("{code} {location}"));
                },
                gix::status::Item::TreeIndex(change) => {
                    use gix::diff::index::Change;
                    let code = match change {
                        Change::Addition { .. } => "A",
                        Change::Deletion { .. } => "D",
                        Change::Modification { .. } => "M",
                        Change::Rewrite { .. } => "R",
                    };
                    modified.push(format!("{code} {location}"));
                },
            }
        }
    }

    let mut recent_commits = Vec::new();
    let mut head_id = None;
    if let Ok(head) = repo.head_commit() {
        head_id = Some(head.id.to_string());
        let walk = repo.rev_walk([head.id]).all().map_err(|e| failed("git log failed", e))?;
        for info in walk.take(5) {
            let info = info.map_err(|e| failed("git log failed", e))?;
            let commit = repo.find_commit(info.id).map_err(|e| failed("git log failed", e))?;
            let author = commit.author().map_err(|e| failed("git log failed", e))?;
            let seconds = commit.time().map(|t| t.seconds).unwrap_or(0);
            let message = commit.message().map_err(|e| failed("git log failed", e))?;
            recent_commits.push(json!({
                "hash": info.id.to_hex_with_len(7).to_string(),
                "author": author.name.to_string(),
                "date": relative_age(seconds),
                "message": message.title.to_string().trim(),
            }));
        }
    }

    Ok(json!({
        "repository": path.to_string_lossy(),
        "branch": branch,
        "head": head_id,
        "clean": modified.is_empty() && untracked.is_empty(),
        "modified_count": modified.len(),
        "untracked_count": untracked.len(),
        "modified_files": modified,
        "untracked_files": untracked,
        "recent_commits": recent_commits,
    }))
}

/// `github_branches`: local and remote-tracking branches with upstream and tip subject.
pub(crate) fn branches(path: &Path) -> Result<Value, SubsystemError> {
    let repo = open(path)?;
    let references = repo.references().map_err(|e| failed("git branch failed", e))?;
    let mut branches = Vec::new();
    for reference in references.all().map_err(|e| failed("git branch failed", e))? {
        let mut reference = reference.map_err(|e| failed("git branch failed", e))?;
        let full = reference.name().as_bstr().to_string();
        let is_local = full.starts_with("refs/heads/");
        if !is_local && !full.starts_with("refs/remotes/") {
            continue;
        }
        let upstream = if is_local {
            repo.branch_remote_tracking_ref_name(reference.name(), gix::remote::Direction::Fetch)
                .and_then(Result::ok)
                .map(|name| short_ref(&name.as_bstr().to_string()))
                .unwrap_or_default()
        } else {
            String::new()
        };
        let subject = reference
            .peel_to_id()
            .ok()
            .map(|id| commit_subject(&repo, id.detach()))
            .unwrap_or_default();
        let name = if is_local {
            short_ref(&full)
        } else {
            // `git branch -a --format=%(refname:short)` prints `origin` for `origin/HEAD`.
            let short = short_ref(&full);
            short.strip_suffix("/HEAD").map(str::to_owned).unwrap_or(short)
        };
        branches.push(json!({
            "name": name,
            "upstream": upstream,
            "latest_subject": subject,
        }));
    }
    Ok(json!({
        "repository": path.to_string_lossy(),
        "count": branches.len(),
        "branches": branches,
    }))
}

/// `github_tree`: `git ls-tree -l <ref> <path>` equivalent read from the object database.
pub(crate) fn tree(path: &Path, ref_name: &str, subpath: &str) -> Result<Value, SubsystemError> {
    let repo = open(path)?;
    let commit = repo
        .rev_parse_single(ref_name)
        .map_err(|e| failed("git ls-tree failed", e))?
        .object()
        .map_err(|e| failed("git ls-tree failed", e))?
        .peel_to_commit()
        .map_err(|e| failed("git ls-tree failed", e))?;
    let root = commit.tree().map_err(|e| failed("git ls-tree failed", e))?;
    let trimmed = subpath.trim_matches('/');
    let trimmed = trimmed.strip_prefix("./").unwrap_or(trimmed);

    // Like `git ls-tree <ref> <dir>` (no trailing slash) the path itself is listed;
    // `.`/empty lists the root, `dir/` lists the directory's children.
    let list_children = trimmed.is_empty() || trimmed == "." || subpath.ends_with('/');
    let mut entries = Vec::new();
    let mut push = |name: String, mode: gix::object::tree::EntryMode, oid: gix::ObjectId| {
        let kind = if mode.is_tree() {
            "tree"
        } else if mode.is_commit() {
            "commit"
        } else {
            "blob"
        };
        let size = if mode.is_blob() || mode.is_link() {
            repo.find_header(oid).map(|h| h.size().to_string()).unwrap_or_else(|_| "-".into())
        } else {
            "-".to_owned()
        };
        entries.push(json!({
            "mode": format!("{:06o}", mode.value()),
            "type": kind,
            "hash": oid.to_hex().to_string(),
            "size": size,
            "name": name,
        }));
    };

    if trimmed.is_empty() || trimmed == "." {
        for entry in root.iter() {
            let entry = entry.map_err(|e| failed("git ls-tree failed", e))?;
            push(entry.filename().to_string(), entry.mode(), entry.object_id());
        }
    } else if let Some(entry) =
        root.lookup_entry_by_path(trimmed).map_err(|e| failed("git ls-tree failed", e))?
    {
        if list_children && entry.mode().is_tree() {
            let subtree = repo
                .find_object(entry.object_id())
                .map_err(|e| failed("git ls-tree failed", e))?
                .into_tree();
            for child in subtree.iter() {
                let child = child.map_err(|e| failed("git ls-tree failed", e))?;
                push(format!("{trimmed}/{}", child.filename()), child.mode(), child.object_id());
            }
        } else {
            push(trimmed.to_owned(), entry.mode(), entry.object_id());
        }
    }

    Ok(json!({
        "repository": path.to_string_lossy(),
        "ref": ref_name,
        "path": subpath,
        "entries_count": entries.len(),
        "entries": entries,
    }))
}

/// `git_ingest`: Transforms a repository or local directory into a prompt-ready LLM digest.
pub(crate) fn ingest(
    path: &Path,
    max_file_size: u64,
    include_patterns: &[String],
    exclude_patterns: &[String],
) -> Result<Value, SubsystemError> {
    let repo_root = path.canonicalize().map_err(|e| failed("resolve repo path", e))?;
    let mut file_entries = Vec::new();

    fn walk_dir(
        root: &Path,
        current: &Path,
        max_size: u64,
        includes: &[String],
        excludes: &[String],
        entries: &mut Vec<(String, String)>,
    ) {
        let Ok(read_dir) = std::fs::read_dir(current) else {
            return;
        };
        for entry in read_dir.flatten() {
            let p = entry.path();
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name == ".git"
                || name == "node_modules"
                || name == "target"
                || name == "build"
                || name == "dist"
            {
                continue;
            }
            if p.is_dir() {
                walk_dir(root, &p, max_size, includes, excludes, entries);
            } else if p.is_file() {
                let rel = match p.strip_prefix(root) {
                    Ok(r) => r.to_string_lossy().replace('\\', "/"),
                    Err(_) => p.to_string_lossy().replace('\\', "/"),
                };
                if excludes.iter().any(|e| rel.contains(e) || name.contains(e)) {
                    continue;
                }
                if !includes.is_empty()
                    && !includes.iter().any(|i| rel.contains(i) || name.contains(i))
                {
                    continue;
                }
                if let Ok(meta) = std::fs::metadata(&p)
                    && meta.len() > max_size
                {
                    continue;
                }
                if let Ok(bytes) = std::fs::read(&p) {
                    let probe_len = bytes.len().min(8192);
                    if bytes[..probe_len].contains(&0) {
                        continue; // skip binary
                    }
                    let content = String::from_utf8_lossy(&bytes).to_string();
                    entries.push((rel, content));
                }
            }
        }
    }

    walk_dir(
        &repo_root,
        &repo_root,
        max_file_size,
        include_patterns,
        exclude_patterns,
        &mut file_entries,
    );
    file_entries.sort_by(|a, b| a.0.cmp(&b.0));

    let slug = repo_root.file_name().and_then(|n| n.to_str()).unwrap_or("project");
    let mut tree = format!("Directory structure:\n└── {slug}/\n");
    for (rel, _) in &file_entries {
        tree.push_str(&format!("    ├── {rel}\n"));
    }

    let mut content = String::new();
    for (rel, text) in &file_entries {
        content.push_str("================================================\n");
        content.push_str(&format!("FILE: {rel}\n"));
        content.push_str("================================================\n");
        content.push_str(text);
        if !text.ends_with('\n') {
            content.push('\n');
        }
        content.push('\n');
    }

    let est_tokens = ((tree.len() + content.len()) as f64 / 3.8).ceil() as usize;
    let formatted_tokens = if est_tokens >= 1_000_000 {
        format!("{:.1}M", est_tokens as f64 / 1_000_000.0)
    } else if est_tokens >= 1_000 {
        format!("{:.1}k", est_tokens as f64 / 1_000.0)
    } else {
        est_tokens.to_string()
    };

    let summary = format!(
        "Directory: {slug}\nFiles analyzed: {}\nEstimated tokens: {formatted_tokens}",
        file_entries.len()
    );

    Ok(json!({
        "summary": summary,
        "tree": tree.trim_end(),
        "content": content,
        "file_count": file_entries.len(),
        "estimated_tokens": est_tokens,
        "formatted_tokens": formatted_tokens,
        "full_context": format!("{summary}\n\n{}\n\n{content}", tree.trim_end()),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    /// Builds a fixture repository with the `git` CLI (test-only; the code under test uses gix).
    fn fixture() -> Option<tempfile::TempDir> {
        let dir = tempfile::tempdir().ok()?;
        let run = |args: &[&str]| {
            Command::new("git")
                .arg("-C")
                .arg(dir.path())
                .args(["-c", "user.name=Test", "-c", "user.email=t@example.com"])
                .args(args)
                .output()
                .ok()
                .filter(|o| o.status.success())
        };
        run(&["init", "-q", "-b", "main"])?;
        std::fs::create_dir(dir.path().join("src")).ok()?;
        std::fs::write(dir.path().join("src/lib.rs"), "fn a() {}\n").ok()?;
        std::fs::write(dir.path().join("README.md"), "hello\n").ok()?;
        run(&["add", "."])?;
        run(&["commit", "-q", "-m", "initial commit"])?;
        run(&["branch", "feature"])?;
        std::fs::write(dir.path().join("README.md"), "changed\n").ok()?;
        std::fs::write(dir.path().join("new.txt"), "x\n").ok()?;
        Some(dir)
    }

    #[test]
    fn status_branches_and_tree_on_temp_repo() {
        let Some(dir) = fixture() else {
            eprintln!("git CLI unavailable to build the fixture; skipping");
            return;
        };
        let status = status(dir.path()).expect("status");
        assert_eq!(status["branch"], "main");
        assert_eq!(status["clean"], false);
        assert_eq!(status["untracked_files"], json!(["new.txt"]));
        assert_eq!(status["modified_files"], json!(["M README.md"]));
        assert_eq!(status["recent_commits"][0]["message"], "initial commit");
        assert_eq!(status["recent_commits"][0]["author"], "Test");

        let branches = branches(dir.path()).expect("branches");
        assert_eq!(branches["count"], 2);
        let names: Vec<_> =
            branches["branches"].as_array().unwrap().iter().map(|b| b["name"].clone()).collect();
        assert!(names.contains(&json!("main")) && names.contains(&json!("feature")));
        assert_eq!(branches["branches"][0]["latest_subject"], "initial commit");

        let root = tree(dir.path(), "HEAD", ".").expect("tree");
        assert_eq!(root["entries_count"], 2);
        let readme = root["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["name"] == "README.md")
            .expect("README entry");
        assert_eq!(readme["type"], "blob");
        assert_eq!(readme["mode"], "100644");
        assert_eq!(readme["size"], "6");

        let dir_entry = tree(dir.path(), "HEAD", "src").expect("tree src");
        assert_eq!(dir_entry["entries"][0]["type"], "tree");
        let children = tree(dir.path(), "main", "src/").expect("tree src/");
        assert_eq!(children["entries"][0]["name"], "src/lib.rs");
    }

    #[test]
    fn relative_age_formats_units() {
        let now =
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()
                as i64;
        assert_eq!(relative_age(now - 7_200), "2 hours ago");
        assert_eq!(relative_age(now - 86_400), "1 day ago");
    }
}
