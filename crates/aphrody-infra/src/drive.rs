// SPDX-License-Identifier: Apache-2.0
//! Virtual Distributed Filesystem (VDFS) Engine & OpenDAL Virtual Mounts.
//!
//! Provides the core filesystem abstraction for Aphrody Drive (Tauri 3 / DrivePane / M3 Explorer),
//! bridging local storage, OpenDAL virtual mounts, in-process Russh SFTP, and Git (gix) trees.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use aphrody_git::{GitBranch, GitCommitGraph, GitCommitNode, GitWorktreeInfo};
use aphrody_ssh::{
    Host,
    in_process::{InProcessSshSession, SftpDriver, SftpTreeNode},
    rsync::DifferentialSummary,
};
use opendal::{Operator, services::Fs};
use serde::{Deserialize, Serialize};

/// Type of virtual storage backend.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", content = "config")]
pub enum MountKind {
    /// Local filesystem root.
    LocalFs { root: PathBuf },
    /// Remote host over in-process Russh & SFTP.
    RemoteSftp { host: Host, remote_root: String },
    /// Native Git object tree without requiring local worktree checkout.
    GitRepo { repo_path: PathBuf },
    /// OpenDAL storage operator backend (FS, memory, S3, etc.).
    OpenDalFs { root: PathBuf },
}

/// A registered virtual mount in the VDFS engine.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VirtualMount {
    pub id: String,
    pub name: String,
    pub kind: MountKind,
    pub read_only: bool,
}

/// File node representation for DrivePane / M3 Explorer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DriveFileNode {
    pub uri: String,
    pub mount_id: String,
    pub relative_path: String,
    pub name: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub permissions: u32,
    pub modified_time: u64,
}

/// Recursive directory tree node for explorer views.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DriveTreeNode {
    pub node: DriveFileNode,
    pub children: Vec<DriveTreeNode>,
}

/// Consolidated Git repository overview for DrivePane integration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitOverview {
    pub branch: Option<String>,
    pub head: Option<String>,
    pub dirty: bool,
    pub branches: Vec<GitBranch>,
    pub recent_commits: Vec<GitCommitNode>,
    pub commit_graph: GitCommitGraph,
    pub worktrees: Vec<GitWorktreeInfo>,
}

/// VDFS Engine managing active virtual mounts and dispatching filesystem requests.
pub struct VirtualDriveEngine {
    mounts: HashMap<String, VirtualMount>,
    opendal_operators: HashMap<String, Operator>,
}

impl VirtualDriveEngine {
    /// Create a new VDFS engine initialized with default Aphrody mounts.
    pub fn new() -> Result<Self> {
        let mut engine = Self { mounts: HashMap::new(), opendal_operators: HashMap::new() };

        // Register default mounts for the current environment
        engine.mount(VirtualMount {
            id: "local".into(),
            name: "Local Workspace".into(),
            kind: MountKind::LocalFs {
                root: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            },
            read_only: false,
        })?;

        engine.mount(VirtualMount {
            id: "vps".into(),
            name: "OVH VPS Remote".into(),
            kind: MountKind::RemoteSftp { host: Host::Vps, remote_root: "/var/www".into() },
            read_only: false,
        })?;

        engine.mount(VirtualMount {
            id: "dbfr".into(),
            name: "Dragon Ball FR Remote".into(),
            kind: MountKind::RemoteSftp { host: Host::Dbfr, remote_root: "/var/www".into() },
            read_only: false,
        })?;

        engine.mount(VirtualMount {
            id: "git".into(),
            name: "Git Repository Tree".into(),
            kind: MountKind::GitRepo {
                repo_path: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            },
            read_only: true,
        })?;

        let artifacts_path =
            std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")).join("artifacts");
        let _ = std::fs::create_dir_all(&artifacts_path);

        engine.mount(VirtualMount {
            id: "storage".into(),
            name: "OpenDAL Artifacts Storage".into(),
            kind: MountKind::OpenDalFs { root: artifacts_path },
            read_only: false,
        })?;

        Ok(engine)
    }

    /// Register or replace a virtual mount.
    pub fn mount(&mut self, mount: VirtualMount) -> Result<()> {
        if let MountKind::OpenDalFs { ref root } = mount.kind {
            let builder = Fs::default().root(&root.to_string_lossy());
            let op = Operator::new(builder)
                .with_context(|| format!("failed to initialize OpenDAL operator for {:?}", root))?;
            self.opendal_operators.insert(mount.id.clone(), op);
        }

        self.mounts.insert(mount.id.clone(), mount);
        Ok(())
    }

    /// Unregister a virtual mount.
    pub fn unmount(&mut self, id: &str) -> Option<VirtualMount> {
        self.opendal_operators.remove(id);
        self.mounts.remove(id)
    }

    /// Enumerate all active virtual mounts.
    pub fn list_mounts(&self) -> Vec<VirtualMount> {
        let mut list: Vec<_> = self.mounts.values().cloned().collect();
        list.sort_by(|a, b| a.id.cmp(&b.id));
        list
    }

    /// Parse a URI of form `vdfs://<mount_id>/<relative_path>` or `<mount_id>:/<path>`.
    pub fn parse_uri(uri: &str) -> Result<(String, String)> {
        let clean = uri.trim();
        if let Some(stripped) = clean.strip_prefix("vdfs://") {
            if let Some((mount_id, rel_path)) = stripped.split_once('/') {
                Ok((mount_id.to_string(), rel_path.to_string()))
            } else {
                Ok((stripped.to_string(), String::new()))
            }
        } else if let Some((mount_id, rel_path)) = clean.split_once(':') {
            let rel = rel_path.trim_start_matches('/');
            Ok((mount_id.to_string(), rel.to_string()))
        } else {
            // Default to local mount
            Ok(("local".to_string(), clean.trim_start_matches('/').to_string()))
        }
    }

    /// List entries in a directory identified by its VDFS URI.
    pub async fn list_dir(&self, uri: &str) -> Result<Vec<DriveFileNode>> {
        let (mount_id, rel_path) = Self::parse_uri(uri)?;
        let mount = self
            .mounts
            .get(&mount_id)
            .with_context(|| format!("virtual mount not found: {mount_id}"))?;

        match &mount.kind {
            MountKind::LocalFs { root } => {
                let target_dir =
                    if rel_path.is_empty() { root.clone() } else { root.join(&rel_path) };

                let mut nodes = Vec::new();
                let read_dir = std::fs::read_dir(&target_dir)
                    .with_context(|| format!("failed to read local dir: {:?}", target_dir))?;

                for entry in read_dir {
                    let entry = entry?;
                    let meta = entry.metadata()?;
                    let name = entry.file_name().to_string_lossy().to_string();
                    let child_rel = if rel_path.is_empty() {
                        name.clone()
                    } else {
                        format!("{rel_path}/{name}")
                    };

                    #[cfg(unix)]
                    let permissions = {
                        use std::os::unix::fs::PermissionsExt;
                        meta.permissions().mode()
                    };
                    #[cfg(not(unix))]
                    let permissions = if meta.permissions().readonly() { 0o444 } else { 0o666 };

                    let modified_time = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);

                    nodes.push(DriveFileNode {
                        uri: format!("vdfs://{mount_id}/{child_rel}"),
                        mount_id: mount_id.clone(),
                        relative_path: child_rel,
                        name,
                        is_dir: meta.is_dir(),
                        is_symlink: meta.is_symlink(),
                        size: meta.len(),
                        permissions,
                        modified_time,
                    });
                }

                nodes.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
                Ok(nodes)
            },
            MountKind::OpenDalFs { .. } => {
                let op = self
                    .opendal_operators
                    .get(&mount_id)
                    .with_context(|| format!("OpenDAL operator missing for {mount_id}"))?;

                let path_str = if rel_path.is_empty() { "" } else { &rel_path };
                let entries = op.list(path_str).await?;
                let mut nodes = Vec::new();

                for entry in entries {
                    let path = entry.path().to_string();
                    let meta = op.stat(&path).await?;
                    let name = Path::new(&path)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(&path)
                        .to_string();

                    nodes.push(DriveFileNode {
                        uri: format!("vdfs://{mount_id}/{path}"),
                        mount_id: mount_id.clone(),
                        relative_path: path.clone(),
                        name,
                        is_dir: meta.is_dir(),
                        is_symlink: false,
                        size: meta.content_length(),
                        permissions: 0o644,
                        modified_time: 0,
                    });
                }
                nodes.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
                Ok(nodes)
            },
            MountKind::GitRepo { repo_path } => {
                let git_nodes = aphrody_git::list_tree_at(repo_path, None, Some(&rel_path))?;
                let nodes = git_nodes
                    .into_iter()
                    .map(|gn| DriveFileNode {
                        uri: format!("vdfs://{mount_id}/{}", gn.path),
                        mount_id: mount_id.clone(),
                        relative_path: gn.path.clone(),
                        name: gn.name,
                        is_dir: gn.is_dir,
                        is_symlink: false,
                        size: 0,
                        permissions: gn.mode,
                        modified_time: 0,
                    })
                    .collect();
                Ok(nodes)
            },
            MountKind::RemoteSftp { host, remote_root } => {
                let full_remote_path = Self::resolve_remote_path(remote_root, &rel_path);

                let session = InProcessSshSession::connect_host(*host).await?;
                let sftp = session.sftp().await?;
                let sftp_entries = SftpDriver::read_dir(&sftp, &full_remote_path).await?;

                let nodes = sftp_entries
                    .into_iter()
                    .map(|entry| {
                        let rel = entry
                            .path
                            .strip_prefix(remote_root)
                            .unwrap_or(&entry.path)
                            .trim_start_matches('/');
                        DriveFileNode {
                            uri: format!("vdfs://{mount_id}/{rel}"),
                            mount_id: mount_id.clone(),
                            relative_path: rel.to_string(),
                            name: entry.name,
                            is_dir: entry.is_dir,
                            is_symlink: entry.is_symlink,
                            size: entry.size,
                            permissions: entry.permissions,
                            modified_time: entry.modified_time as u64,
                        }
                    })
                    .collect();
                Ok(nodes)
            },
        }
    }

    /// Recursively build file tree up to `max_depth` for explorer view.
    pub async fn tree(&self, uri: &str, max_depth: usize) -> Result<DriveTreeNode> {
        let (mount_id, rel_path) = Self::parse_uri(uri)?;
        let mount = self
            .mounts
            .get(&mount_id)
            .with_context(|| format!("virtual mount not found: {mount_id}"))?;

        match &mount.kind {
            MountKind::RemoteSftp { host, remote_root } => {
                let full_path = if rel_path.is_empty() {
                    remote_root.clone()
                } else {
                    format!("{remote_root}/{rel_path}")
                };
                let session = InProcessSshSession::connect_host(*host).await?;
                let sftp = session.sftp().await?;
                let sftp_tree = SftpDriver::tree(&sftp, &full_path, max_depth).await?;
                Ok(convert_sftp_tree(&mount_id, remote_root, sftp_tree))
            },
            _ => {
                // Generic traversal for local / opendal / git mounts
                let root_node = DriveFileNode {
                    uri: format!("vdfs://{mount_id}/{rel_path}"),
                    mount_id: mount_id.clone(),
                    relative_path: rel_path.clone(),
                    name: if rel_path.is_empty() { mount.name.clone() } else { rel_path.clone() },
                    is_dir: true,
                    is_symlink: false,
                    size: 0,
                    permissions: 0o755,
                    modified_time: 0,
                };
                let mut tree_node = DriveTreeNode { node: root_node, children: Vec::new() };
                if max_depth > 0 {
                    self.build_tree_recursive(&mut tree_node, max_depth - 1).await?;
                }
                Ok(tree_node)
            },
        }
    }

    async fn build_tree_recursive(
        &self,
        parent: &mut DriveTreeNode,
        depth_left: usize,
    ) -> Result<()> {
        let entries = self.list_dir(&parent.node.uri).await?;
        for entry in entries {
            let is_dir = entry.is_dir;
            let mut child = DriveTreeNode { node: entry, children: Vec::new() };
            if is_dir && depth_left > 0 {
                Box::pin(self.build_tree_recursive(&mut child, depth_left - 1)).await?;
            }
            parent.children.push(child);
        }
        Ok(())
    }

    /// Read raw file bytes from any virtual mount.
    pub async fn read_file(&self, uri: &str) -> Result<Vec<u8>> {
        let (mount_id, rel_path) = Self::parse_uri(uri)?;
        let mount = self
            .mounts
            .get(&mount_id)
            .with_context(|| format!("virtual mount not found: {mount_id}"))?;

        match &mount.kind {
            MountKind::LocalFs { root } => {
                let file_path = root.join(&rel_path);
                std::fs::read(&file_path)
                    .with_context(|| format!("failed to read local file: {:?}", file_path))
            },
            MountKind::OpenDalFs { .. } => {
                let op = self
                    .opendal_operators
                    .get(&mount_id)
                    .with_context(|| format!("OpenDAL operator missing for {mount_id}"))?;
                let bytes = op.read(&rel_path).await?;
                Ok(bytes.to_vec())
            },
            MountKind::RemoteSftp { host, remote_root } => {
                let full_path = Self::resolve_remote_path(remote_root, &rel_path);
                let session = InProcessSshSession::connect_host(*host).await?;
                let sftp = session.sftp().await?;
                SftpDriver::read_file(&sftp, &full_path).await
            },
            MountKind::GitRepo { repo_path } => {
                let repo = gix::open(repo_path)
                    .with_context(|| format!("failed to open git repository: {repo_path:?}"))?;
                let tree = repo.head_commit()?.tree()?;
                let entry = tree
                    .lookup_entry_by_path(&rel_path)?
                    .with_context(|| format!("path not found in HEAD tree: {rel_path}"))?;
                if entry.mode().is_tree() {
                    bail!("path is a directory in the git tree: {rel_path}");
                }
                Ok(entry.object()?.detach().data)
            },
        }
    }

    /// Write raw file bytes to any writable virtual mount with fast-rsync differential support.
    pub async fn write_file(
        &self,
        uri: &str,
        content: &[u8],
        differential: bool,
    ) -> Result<DifferentialSummary> {
        let (mount_id, rel_path) = Self::parse_uri(uri)?;
        let mount = self
            .mounts
            .get(&mount_id)
            .with_context(|| format!("virtual mount not found: {mount_id}"))?;

        if mount.read_only {
            bail!("mount {mount_id} is read-only");
        }

        match &mount.kind {
            MountKind::LocalFs { root } => {
                let file_path = root.join(&rel_path);
                if let Some(parent) = file_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }

                if differential && file_path.exists() {
                    let base = std::fs::read(&file_path)?;
                    let (delta, summary) = aphrody_ssh::rsync::compute_delta_from_buffers(
                        &base,
                        content,
                        aphrody_ssh::rsync::RsyncOptions::default(),
                    )?;
                    let restored = aphrody_ssh::rsync::apply_delta(&base, &delta)?;
                    std::fs::write(&file_path, &restored)?;
                    Ok(summary)
                } else {
                    std::fs::write(&file_path, content)?;
                    Ok(DifferentialSummary {
                        original_size: 0,
                        modified_size: content.len() as u64,
                        signature_size: 0,
                        delta_size: content.len(),
                        savings_percentage: 0,
                    })
                }
            },
            MountKind::OpenDalFs { .. } => {
                let op = self
                    .opendal_operators
                    .get(&mount_id)
                    .with_context(|| format!("OpenDAL operator missing for {mount_id}"))?;
                op.write(&rel_path, content.to_vec()).await?;
                Ok(DifferentialSummary {
                    original_size: 0,
                    modified_size: content.len() as u64,
                    signature_size: 0,
                    delta_size: content.len(),
                    savings_percentage: 0,
                })
            },
            MountKind::RemoteSftp { host, remote_root } => {
                let full_path = Self::resolve_remote_path(remote_root, &rel_path);
                let session = InProcessSshSession::connect_host(*host).await?;
                let sftp = session.sftp().await?;

                if differential {
                    SftpDriver::upload_differential(&sftp, content, &full_path).await
                } else {
                    SftpDriver::write_file(&sftp, &full_path, content).await?;
                    Ok(DifferentialSummary {
                        original_size: 0,
                        modified_size: content.len() as u64,
                        signature_size: 0,
                        delta_size: content.len(),
                        savings_percentage: 0,
                    })
                }
            },
            MountKind::GitRepo { .. } => {
                bail!("writing to GitRepo mount is not allowed directly; use Git commit workflow")
            },
        }
    }

    /// Resolve a user-supplied relative or absolute path against a remote root.
    fn resolve_remote_path(remote_root: &str, rel_path: &str) -> String {
        let trimmed_rel = rel_path.trim_start_matches('/');
        if trimmed_rel.is_empty() {
            return remote_root.to_string();
        }
        let root_trimmed = remote_root.trim_start_matches('/');
        let sub = if trimmed_rel == root_trimmed {
            ""
        } else if let Some(stripped) = trimmed_rel.strip_prefix(root_trimmed) {
            stripped.trim_start_matches('/')
        } else {
            trimmed_rel
        };

        if sub.is_empty() {
            remote_root.to_string()
        } else if remote_root.ends_with('/') {
            format!("{remote_root}{sub}")
        } else {
            format!("{remote_root}/{sub}")
        }
    }

    /// Retrieve consolidated Git status, commit graph, and branches for a local or remote repository.
    /// Accepts a mount ID (e.g. "git") or a filesystem path (e.g. "." or "/path/to/repo").
    pub fn git_overview(&self, mount_or_path: impl AsRef<Path>) -> Result<GitOverview> {
        let p = mount_or_path.as_ref();
        let repo_path = if let Some(str_key) = p.to_str() {
            if let Some(mount) = self.mounts.get(str_key) {
                match &mount.kind {
                    MountKind::GitRepo { repo_path } => repo_path.clone(),
                    MountKind::LocalFs { root } => root.clone(),
                    _ => {
                        bail!("mount '{str_key}' is not a Git repository or local filesystem mount")
                    },
                }
            } else {
                p.to_path_buf()
            }
        } else {
            p.to_path_buf()
        };

        let repo_info = aphrody_git::inspect_repository(&repo_path)?;
        let branches = aphrody_git::list_branches(&repo_path)?;
        let recent_commits = aphrody_git::commit_log(&repo_path, 20)?;
        let commit_graph = aphrody_git::commit_graph(&repo_path, 50)?;
        let worktrees = aphrody_git::list_worktrees(&repo_path)?;

        Ok(GitOverview {
            branch: repo_info.branch,
            head: repo_info.head,
            dirty: repo_info.dirty,
            branches,
            recent_commits,
            commit_graph,
            worktrees,
        })
    }
}

fn convert_sftp_tree(mount_id: &str, remote_root: &str, node: SftpTreeNode) -> DriveTreeNode {
    let rel = node
        .entry
        .path
        .strip_prefix(remote_root)
        .unwrap_or(&node.entry.path)
        .trim_start_matches('/');
    let file_node = DriveFileNode {
        uri: format!("vdfs://{mount_id}/{rel}"),
        mount_id: mount_id.to_string(),
        relative_path: rel.to_string(),
        name: node.entry.name,
        is_dir: node.entry.is_dir,
        is_symlink: node.entry.is_symlink,
        size: node.entry.size,
        permissions: node.entry.permissions,
        modified_time: node.entry.modified_time as u64,
    };

    let children =
        node.children.into_iter().map(|c| convert_sftp_tree(mount_id, remote_root, c)).collect();

    DriveTreeNode { node: file_node, children }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_vdfs_engine_initializes_and_lists_mounts() {
        let engine = VirtualDriveEngine::new().expect("VDFS init");
        let mounts = engine.list_mounts();
        assert!(mounts.iter().any(|m| m.id == "local"));
        assert!(mounts.iter().any(|m| m.id == "vps"));
        assert!(mounts.iter().any(|m| m.id == "dbfr"));
        assert!(mounts.iter().any(|m| m.id == "git"));
        assert!(mounts.iter().any(|m| m.id == "storage"));
    }

    #[tokio::test]
    async fn test_vdfs_local_read_write_differential() {
        let temp = tempfile::tempdir().unwrap();
        let mut engine = VirtualDriveEngine::new().unwrap();

        engine
            .mount(VirtualMount {
                id: "test".into(),
                name: "Test Mount".into(),
                kind: MountKind::LocalFs { root: temp.path().to_path_buf() },
                read_only: false,
            })
            .unwrap();

        let uri = "vdfs://test/doc.txt";
        let base_content = b"Original Aphrody documentation content for differential testing.";
        let initial_summary = engine.write_file(uri, base_content, false).await.unwrap();
        assert_eq!(initial_summary.modified_size, base_content.len() as u64);

        let read_back = engine.read_file(uri).await.unwrap();
        assert_eq!(read_back, base_content);

        let updated_content =
            b"Original Aphrody documentation content for differential testing with new additions.";
        let diff_summary = engine.write_file(uri, updated_content, true).await.unwrap();
        assert!(diff_summary.delta_size > 0);

        let read_updated = engine.read_file(uri).await.unwrap();
        assert_eq!(read_updated, updated_content);
    }

    #[tokio::test]
    async fn test_vdfs_git_overview() {
        let temp = tempfile::tempdir().expect("temporary Git repository");
        let init = std::process::Command::new("git")
            .arg("init")
            .arg("--quiet")
            .arg(temp.path())
            .output()
            .expect("run git init");
        assert!(init.status.success(), "{}", String::from_utf8_lossy(&init.stderr));
        std::fs::write(temp.path().join("README.md"), "Git overview fixture\n")
            .expect("write fixture");
        let add = std::process::Command::new("git")
            .arg("-C")
            .arg(temp.path())
            .args(["add", "README.md"])
            .output()
            .expect("run git add");
        assert!(add.status.success(), "{}", String::from_utf8_lossy(&add.stderr));
        let commit = std::process::Command::new("git")
            .arg("-C")
            .arg(temp.path())
            .args([
                "-c",
                "user.name=aphrody-code",
                "-c",
                "user.email=contact@aphrody.com",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "--quiet",
                "-m",
                "Fixture",
            ])
            .output()
            .expect("run git commit");
        assert!(commit.status.success(), "{}", String::from_utf8_lossy(&commit.stderr));

        let mut engine = VirtualDriveEngine::new().unwrap();
        engine
            .mount(VirtualMount {
                id: "git".into(),
                name: "Git fixture".into(),
                kind: MountKind::GitRepo { repo_path: temp.path().to_path_buf() },
                read_only: true,
            })
            .expect("mount fixture");
        let overview = engine.git_overview("git").expect("git mount overview");
        assert!(overview.branch.is_some());
        assert!(!overview.branches.is_empty());
        assert!(!overview.recent_commits.is_empty());
        assert!(!overview.worktrees.is_empty());

        let overview_path = engine.git_overview(temp.path()).expect("path overview");
        assert_eq!(overview.branch, overview_path.branch);
    }
}
