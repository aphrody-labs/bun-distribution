// SPDX-License-Identifier: Apache-2.0
//! File-based WinClean coordination compatibility mirror.
//! The typed A2A transport lives outside aphrody-os; these frozen tools only
//! preserve the legacy files for callers that still use them.

use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use crate::SubsystemError;
use serde_json::{Value, json};

static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

fn failed(error: impl std::fmt::Display) -> SubsystemError {
    SubsystemError::Failed(error.to_string())
}

fn string_arg<'a>(args: &'a Value, name: &str, tool: &str) -> Result<&'a str, SubsystemError> {
    args.get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| SubsystemError::InvalidArguments(format!("{tool} requires string {name}")))
}

fn root() -> Result<PathBuf, SubsystemError> {
    if let Some(value) = std::env::var_os("APHRODY_COORD_ROOT").filter(|value| !value.is_empty()) {
        let path = PathBuf::from(value);
        return if path.is_absolute() {
            Ok(path)
        } else {
            Err(SubsystemError::InvalidArguments(
                "APHRODY_COORD_ROOT must be absolute".into(),
            ))
        };
    }
    #[cfg(windows)]
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join("AppData/Local"))
        });
    #[cfg(not(windows))]
    let base = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/state")));
    base.map(|path| path.join("aphrody/coord"))
        .ok_or_else(|| SubsystemError::Unavailable("no per-user state directory".into()))
}

fn agent_file(agent: &str) -> Result<PathBuf, SubsystemError> {
    let name = agent.trim();
    if name.is_empty()
        || name
            .chars()
            .any(|c| c == '/' || c == '\\' || c == ':' || c.is_control())
    {
        return Err(SubsystemError::InvalidArguments(
            "agent must be a non-empty safe name".into(),
        ));
    }
    let canonical = match name.to_ascii_uppercase().as_str() {
        "CLAUDE" | "WINCLEAN-CLAUDE" => "CLAUDE".to_owned(),
        other => other.to_owned(),
    };
    Ok(root()?.join(format!("STATUS_{canonical}.txt")))
}

fn atomic_write(path: &Path, body: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing parent"))?;
    fs::create_dir_all(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
    }
    let sequence = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(format!(".coord-{}-{sequence}.tmp", std::process::id()));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(body)?;
        file.sync_all()?;
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn read_optional(path: &Path) -> Result<String, SubsystemError> {
    match fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(failed(error)),
    }
}

pub(crate) fn report_status(arguments: &Value) -> Result<Value, SubsystemError> {
    let agent = string_arg(arguments, "agent", "coord_report_status")?;
    let status = string_arg(arguments, "status", "coord_report_status")?;
    let path = agent_file(agent)?;
    let body = format!("{}\n", status.trim_end());
    atomic_write(&path, body.as_bytes()).map_err(failed)?;
    Ok(json!({"ok":true,"agent":agent,"path":path,"bytes":body.len()}))
}

pub(crate) fn read_status(arguments: &Value) -> Result<Value, SubsystemError> {
    let agent = string_arg(arguments, "agent", "coord_read_status")?;
    let path = agent_file(agent)?;
    let status = read_optional(&path)?.trim_end().to_owned();
    Ok(json!({"ok":true,"agent":agent,"path":path,"status":status}))
}

pub(crate) fn assign_task(arguments: &Value) -> Result<Value, SubsystemError> {
    let markdown = string_arg(arguments, "markdown", "coord_assign_task")?;
    let path = root()?.join("CURRENT_TASK.md");
    atomic_write(&path, markdown.as_bytes()).map_err(failed)?;
    Ok(json!({"ok":true,"path":path,"bytes":markdown.len()}))
}

pub(crate) fn read_task() -> Result<Value, SubsystemError> {
    let path = root()?.join("CURRENT_TASK.md");
    Ok(json!({"ok":true,"path":path,"content":read_optional(&path)?}))
}

pub(crate) fn query_stop() -> Result<Value, SubsystemError> {
    Ok(json!({"ok":true,"stop":root()?.join("STOP").is_file()}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_complete_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("CURRENT_TASK.md");
        atomic_write(&path, b"first").unwrap();
        atomic_write(&path, b"second").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "second");
    }
}
