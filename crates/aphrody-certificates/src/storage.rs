// SPDX-License-Identifier: Apache-2.0
use anyhow::{Result, ensure};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

pub fn output_directory(path: &Path, workspace: &Path) -> Result<PathBuf> {
    ensure!(
        path.is_absolute(),
        "protected output directory must be absolute"
    );
    ensure!(
        path.exists(),
        "protected output directory must already exist"
    );
    ensure!(
        !fs::symlink_metadata(path)?.file_type().is_symlink(),
        "symlink output refused"
    );
    let root = path.canonicalize()?;
    let workspace = workspace.canonicalize()?;
    ensure!(
        !root.starts_with(workspace),
        "protected output must be outside the workspace"
    );
    ensure!(root.is_dir(), "protected output must be a directory");
    secure(&root, true)?;
    Ok(root)
}

pub fn hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

pub fn save(root: &Path, name: &str, bytes: &[u8]) -> Result<()> {
    ensure!(
        !name.contains(['/', '\\']) && !name.starts_with('.'),
        "invalid storage name"
    );
    let target = root.join(name);
    if target.exists() {
        ensure!(
            !fs::symlink_metadata(&target)?.file_type().is_symlink(),
            "symlink file refused"
        );
        let previous = fs::read(&target)?;
        let backup = root.join(format!("{name}.{}.backup", uuid::Uuid::new_v4()));
        create(&backup, &previous)?;
        ensure!(
            hash(&fs::read(&backup)?) == hash(&previous),
            "backup checksum mismatch"
        );
        create(&backup.with_extension("sha256"), hash(&previous).as_bytes())?;
    }
    let temp = root.join(format!("{name}.{}.tmp", uuid::Uuid::new_v4()));
    create(&temp, bytes)?;
    // Windows rename cannot replace existing files. Backups above are verified first.
    #[cfg(windows)]
    if target.exists() {
        fs::remove_file(&target)?;
    }
    fs::rename(&temp, &target)?;
    secure(&target, false)?;
    Ok(())
}

fn create(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    secure(path, false)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

#[cfg(unix)]
fn secure(path: &Path, directory: bool) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(
        path,
        fs::Permissions::from_mode(if directory { 0o700 } else { 0o600 }),
    )?;
    Ok(())
}

#[cfg(windows)]
fn secure(path: &Path, directory: bool) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::{
            Authorization::{
                ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
            },
            DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, SetFileSecurityW,
        },
    };
    let sddl = if directory {
        "D:P(A;OICI;FA;;;OW)(A;OICI;FA;;;SY)"
    } else {
        "D:P(A;;FA;;;OW)(A;;FA;;;SY)"
    };
    let descriptor_text: Vec<u16> = sddl.encode_utf16().chain(Some(0)).collect();
    let path_text: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut descriptor = std::ptr::null_mut();
    // SAFETY: null-terminated live buffers; descriptor is allocated by Windows and freed once.
    unsafe {
        if ConvertStringSecurityDescriptorToSecurityDescriptorW(
            descriptor_text.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            std::ptr::null_mut(),
        ) == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        let result = SetFileSecurityW(
            path_text.as_ptr(),
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            descriptor,
        );
        let error = std::io::Error::last_os_error();
        LocalFree(descriptor);
        if result == 0 {
            return Err(error.into());
        }
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn secure(_: &Path, _: bool) -> Result<()> {
    anyhow::bail!("protected storage unsupported on this target")
}

#[cfg(test)]
mod tests {
    #[test]
    fn checksum_matches_standard_sha256_vectors() {
        assert_eq!(
            super::hash(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            super::hash(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
