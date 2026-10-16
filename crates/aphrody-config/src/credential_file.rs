// SPDX-License-Identifier: Apache-2.0
//! Read explicit credentials from the configured host's protected private store.

use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};

#[derive(Debug, thiserror::Error)]
#[error("protected credential file is unavailable or invalid")]
pub struct CredentialFileError;

/// Resolve an explicit file reference without putting its contents into configuration.
///
/// # Errors
/// Rejects paths outside the private store, links, broad permissions and invalid tokens.
pub fn read_credential_file(path: &Path) -> Result<String, CredentialFileError> {
    let root = std::env::var_os("APHRODY_HOME")
        .filter(|root| !root.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                .map(|home| PathBuf::from(home).join(".aphrody"))
        })
        .ok_or(CredentialFileError)?;
    read_from_private_root(path, &root.join("private"))
}

fn read_from_private_root(path: &Path, root: &Path) -> Result<String, CredentialFileError> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(CredentialFileError);
    }
    let mut current = PathBuf::new();
    for part in path.components() {
        current.push(part);
        let metadata = fs::symlink_metadata(&current).map_err(|_| CredentialFileError)?;
        if metadata.file_type().is_symlink() {
            return Err(CredentialFileError);
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(CredentialFileError);
            }
        }
    }
    let root = fs::canonicalize(root).map_err(|_| CredentialFileError)?;
    let canonical = fs::canonicalize(path).map_err(|_| CredentialFileError)?;
    if !canonical.starts_with(&root) || canonical == root {
        return Err(CredentialFileError);
    }
    let metadata = fs::metadata(&canonical).map_err(|_| CredentialFileError)?;
    if !metadata.is_file() || metadata.len() > 4096 {
        return Err(CredentialFileError);
    }
    validate_permissions(&canonical, &metadata)?;
    let mut file = fs::File::open(&canonical).map_err(|_| CredentialFileError)?;
    let mut bytes = Vec::new();
    file.by_ref()
        .take(4097)
        .read_to_end(&mut bytes)
        .map_err(|_| CredentialFileError)?;
    if bytes.len() > 4096 {
        return Err(CredentialFileError);
    }
    let token = String::from_utf8(bytes).map_err(|_| CredentialFileError)?;
    let token = token.trim();
    if token.is_empty() || token.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(CredentialFileError);
    }
    Ok(token.to_owned())
}

#[cfg(unix)]
fn validate_permissions(_: &Path, metadata: &fs::Metadata) -> Result<(), CredentialFileError> {
    use std::os::unix::fs::PermissionsExt;
    if metadata.permissions().mode() & 0o077 != 0 {
        Err(CredentialFileError)
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn validate_permissions(path: &Path, _: &fs::Metadata) -> Result<(), CredentialFileError> {
    use std::{
        os::windows::process::CommandExt,
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    let script = "$ErrorActionPreference='Stop';$acl=Get-Acl -LiteralPath $env:APHRODY_CREDENTIAL_FILE_PATH;$sddl=$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access);if(!$sddl -or $sddl -match 'NO_ACCESS_CONTROL' -or @($acl.Access).Count -eq 0){exit 1};$me=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$allowed=@($me,'S-1-5-18','S-1-5-32-544');foreach($rule in $acl.Access){if($rule.AccessControlType -eq 'Allow' -and (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadData) -ne 0)){if($allowed -notcontains $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value){exit 1}}};exit 0";
    let mut child = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .env("APHRODY_CREDENTIAL_FILE_PATH", path)
        .env_remove("PSModulePath")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(0x0800_0000)
        .spawn()
        .map_err(|_| CredentialFileError)?;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return if status.success() {
                    Ok(())
                } else {
                    Err(CredentialFileError)
                };
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(CredentialFileError);
            }
        }
    }
}

#[cfg(not(any(unix, windows)))]
fn validate_permissions(_: &Path, _: &fs::Metadata) -> Result<(), CredentialFileError> {
    Err(CredentialFileError)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_missing_and_outside_store_without_disclosing_contents() {
        let dir = tempfile::tempdir().unwrap();
        let private = dir.path().join("private");
        fs::create_dir(&private).unwrap();
        let outside = dir.path().join("token");
        fs::write(&outside, "fixture-secret-token").unwrap();
        let error = read_from_private_root(&outside, &private).unwrap_err();
        assert_eq!(
            error.to_string(),
            "protected credential file is unavailable or invalid"
        );
        assert!(read_from_private_root(&private.join("missing"), &private).is_err());
    }
    #[cfg(windows)]
    #[test]
    fn reads_owner_only_fixture_and_refuses_broad_acl_and_invalid_tokens() {
        use std::process::Command;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("private");
        fs::create_dir(&root).unwrap();
        let path = root.join("token");
        fs::write(&path, "fixture-token\n").unwrap();
        let restrict = "$ErrorActionPreference='Stop';$p=$env:APHRODY_CREDENTIAL_FILE_PATH;$acl=Get-Acl -LiteralPath $p;$acl.SetAccessRuleProtection($true,$false);$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow');$acl.AddAccessRule($rule);Set-Acl -LiteralPath $p -AclObject $acl";
        let status = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", restrict])
            .env("APHRODY_CREDENTIAL_FILE_PATH", &path)
            .env_remove("PSModulePath")
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(
            read_from_private_root(&path, &root).unwrap(),
            "fixture-token"
        );
        fs::write(&path, "x".repeat(4097)).unwrap();
        assert!(read_from_private_root(&path, &root).is_err());
        fs::write(&path, "\r\n").unwrap();
        assert!(read_from_private_root(&path, &root).is_err());
        fs::write(&path, "fixture-token").unwrap();
        let broaden = "$ErrorActionPreference='Stop';$p=$env:APHRODY_CREDENTIAL_FILE_PATH;$acl=New-Object Security.AccessControl.FileSecurity;$acl.SetAccessRuleProtection($true,$false);$me=[Security.Principal.WindowsIdentity]::GetCurrent().User;$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($me,'FullControl','Allow')));$sid=New-Object Security.Principal.SecurityIdentifier('S-1-5-32-545');$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'Read','Allow')));[IO.File]::SetAccessControl($p,$acl)";
        assert!(
            Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", broaden])
                .env("APHRODY_CREDENTIAL_FILE_PATH", &path)
                .env_remove("PSModulePath")
                .status()
                .unwrap()
                .success()
        );
        assert!(read_from_private_root(&path, &root).is_err());
        let null_acl = "$ErrorActionPreference='Stop';$acl=New-Object Security.AccessControl.FileSecurity;$acl.SetSecurityDescriptorSddlForm('D:NO_ACCESS_CONTROL',[Security.AccessControl.AccessControlSections]::Access);[IO.File]::SetAccessControl($env:APHRODY_CREDENTIAL_FILE_PATH,$acl)";
        assert!(
            Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-Command", null_acl])
                .env("APHRODY_CREDENTIAL_FILE_PATH", &path)
                .env_remove("PSModulePath")
                .status()
                .unwrap()
                .success()
        );
        assert!(read_from_private_root(&path, &root).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn enforces_permissions_token_limits_and_links() {
        use std::os::unix::{fs::PermissionsExt, fs::symlink};
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("private");
        fs::create_dir(&root).unwrap();
        let path = root.join("token");
        fs::write(&path, "fixture-token\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(
            read_from_private_root(&path, &root).unwrap(),
            "fixture-token"
        );
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(read_from_private_root(&path, &root).is_err());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        fs::write(&path, " ").unwrap();
        assert!(read_from_private_root(&path, &root).is_err());
        fs::write(&path, "x".repeat(4097)).unwrap();
        assert!(read_from_private_root(&path, &root).is_err());
        let link = root.join("link");
        symlink(&path, &link).unwrap();
        assert!(read_from_private_root(&link, &root).is_err());
    }
}
