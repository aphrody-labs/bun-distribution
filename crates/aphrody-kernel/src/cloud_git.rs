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
    let mut line = if head.is_unborn() {
        format!("No commits yet on {short}")
    } else {
        short
    };
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
                        }
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
                }
                gix::status::Item::TreeIndex(change) => {
                    use gix::diff::index::Change;
                    let code = match change {
                        Change::Addition { .. } => "A",
                        Change::Deletion { .. } => "D",
                        Change::Modification { .. } => "M",
                        Change::Rewrite { .. } => "R",
                    };
                    modified.push(format!("{code} {location}"));
                }
            }
        }
    }

    let mut recent_commits = Vec::new();
    let mut head_id = None;
    if let Ok(head) = repo.head_commit() {
        head_id = Some(head.id.to_string());
        let walk = repo
            .rev_walk([head.id])
            .all()
            .map_err(|e| failed("git log failed", e))?;
        for info in walk.take(5) {
            let info = info.map_err(|e| failed("git log failed", e))?;
            let commit = repo
                .find_commit(info.id)
                .map_err(|e| failed("git log failed", e))?;
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

/// Which branches `github_branches` lists.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BranchQuery {
    /// Case-insensitive substring of the short branch name.
    pub filter: Option<String>,
    /// `local`, `remote` or `all`.
    pub scope: String,
    /// Page size.
    pub limit: usize,
    /// Branches skipped before the page.
    pub offset: usize,
}

impl Default for BranchQuery {
    fn default() -> Self {
        Self {
            filter: None,
            scope: "all".into(),
            limit: BRANCH_PAGE,
            offset: 0,
        }
    }
}

/// Default page of `github_branches`; forks of large projects carry tens of thousands of
/// remote branches.
pub(crate) const BRANCH_PAGE: usize = 50;
/// Largest accepted page.
pub(crate) const BRANCH_PAGE_MAX: usize = 1000;

/// `github_branches`: local and remote-tracking branches (local first, then by name), filtered and
/// paginated; each listed local branch carries its upstream and ahead/behind counts.
pub(crate) fn branches(path: &Path, query: &BranchQuery) -> Result<Value, SubsystemError> {
    let (want_local, want_remote) = match query.scope.as_str() {
        "all" => (true, true),
        "local" => (true, false),
        "remote" => (false, true),
        other => {
            return Err(SubsystemError::InvalidArguments(format!(
                "scope must be local, remote or all, not `{other}`"
            )));
        }
    };
    let limit = query.limit.clamp(1, BRANCH_PAGE_MAX);
    let needle = query
        .filter
        .as_deref()
        .map(str::to_lowercase)
        .filter(|n| !n.is_empty());
    let repo = open(path)?;
    let references = repo
        .references()
        .map_err(|e| failed("git branch failed", e))?;
    let mut matching: Vec<(bool, String, String)> = Vec::new();
    for reference in references
        .all()
        .map_err(|e| failed("git branch failed", e))?
    {
        let reference = reference.map_err(|e| failed("git branch failed", e))?;
        let full = reference.name().as_bstr().to_string();
        let is_local = full.starts_with("refs/heads/");
        if !(is_local && want_local || full.starts_with("refs/remotes/") && want_remote) {
            continue;
        }
        let name = if is_local {
            short_ref(&full)
        } else {
            // `git branch -a --format=%(refname:short)` prints `origin` for `origin/HEAD`.
            let short = short_ref(&full);
            short
                .strip_suffix("/HEAD")
                .map(str::to_owned)
                .unwrap_or(short)
        };
        if needle
            .as_ref()
            .is_some_and(|n| !name.to_lowercase().contains(n.as_str()))
        {
            continue;
        }
        matching.push((is_local, name, full));
    }
    matching.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    let total = matching.len();
    let mut branches = Vec::new();
    for (is_local, name, full) in matching.into_iter().skip(query.offset).take(limit) {
        let mut reference = repo
            .find_reference(full.as_str())
            .map_err(|e| failed("git branch failed", e))?;
        let tip = reference.peel_to_id().ok().map(gix::Id::detach);
        let subject = tip.map(|id| commit_subject(&repo, id)).unwrap_or_default();
        let mut entry = json!({ "name": name, "local": is_local, "latest_subject": subject });
        if is_local {
            let upstream = repo
                .branch_remote_tracking_ref_name(reference.name(), gix::remote::Direction::Fetch)
                .and_then(Result::ok);
            entry["upstream"] = json!(
                upstream
                    .as_ref()
                    .map(|n| short_ref(&n.as_bstr().to_string()))
                    .unwrap_or_default()
            );
            let upstream_tip = upstream.and_then(|n| {
                repo.find_reference(n.as_ref())
                    .ok()?
                    .peel_to_id()
                    .ok()
                    .map(gix::Id::detach)
            });
            if let (Some(tip), Some(upstream_tip)) = (tip, upstream_tip) {
                let count = |from: gix::ObjectId, hidden: gix::ObjectId| {
                    repo.rev_walk([from])
                        .with_hidden([hidden])
                        .all()
                        .map_or(0, Iterator::count)
                };
                entry["ahead"] = json!(count(tip, upstream_tip));
                entry["behind"] = json!(count(upstream_tip, tip));
            }
        }
        branches.push(entry);
    }
    let next = query.offset + branches.len();
    Ok(json!({
        "repository": path.to_string_lossy(),
        "total": total,
        "count": branches.len(),
        "offset": query.offset,
        "next_offset": if next < total { json!(next) } else { Value::Null },
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
    let trimmed = trimmed.strip_prefix(".//").unwrap_or(trimmed);

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
            repo.find_header(oid)
                .map(|h| h.size().to_string())
                .unwrap_or_else(|_| "-".into())
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
            push(
                entry.filename().to_string(),
                entry.mode(),
                entry.object_id(),
            );
        }
    } else if let Some(entry) = root
        .lookup_entry_by_path(trimmed)
        .map_err(|e| failed("git ls-tree failed", e))?
    {
        if list_children && entry.mode().is_tree() {
            let subtree = repo
                .find_object(entry.object_id())
                .map_err(|e| failed("git ls-tree failed", e))?
                .into_tree();
            for child in subtree.iter() {
                let child = child.map_err(|e| failed("git ls-tree failed", e))?;
                push(
                    format!("{trimmed}/{}", child.filename()),
                    child.mode(),
                    child.object_id(),
                );
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

        let branches = branches(dir.path(), &BranchQuery::default()).expect("branches");
        assert_eq!(branches["count"], 2);
        let names: Vec<_> = branches["branches"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b["name"].clone())
            .collect();
        assert_eq!(names, [json!("feature"), json!("main")]);
        assert_eq!(branches["branches"][0]["latest_subject"], "initial commit");
        assert_eq!(branches["next_offset"], Value::Null);

        let page = |filter: Option<&str>, scope: &str, limit: usize, offset: usize| {
            super::branches(
                dir.path(),
                &BranchQuery {
                    filter: filter.map(str::to_owned),
                    scope: scope.into(),
                    limit,
                    offset,
                },
            )
        };
        let first = page(None, "all", 1, 0).expect("page");
        assert_eq!(
            (first["total"].clone(), first["count"].clone()),
            (json!(2), json!(1))
        );
        assert_eq!(first["next_offset"], 1);
        let second = page(None, "all", 1, 1).expect("page");
        assert_eq!(second["branches"][0]["name"], "main");
        assert_eq!(second["next_offset"], Value::Null);
        let filtered = page(Some("FEAT"), "all", 10, 0).expect("filter");
        assert_eq!(filtered["total"], 1);
        assert_eq!(filtered["branches"][0]["name"], "feature");
        assert_eq!(page(None, "remote", 10, 0).expect("remote")["total"], 0);
        assert!(page(None, "every", 10, 0).is_err());

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
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        assert_eq!(relative_age(now - 7_200), "2 hours ago");
        assert_eq!(relative_age(now - 86_400), "1 day ago");
    }
}
