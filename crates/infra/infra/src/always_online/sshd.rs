// SPDX-License-Identifier: Apache-2.0
//! Windows SSH recovery independent of the WireGuard address. No auth directive is rewritten.

use anyhow::{Context, Result, bail};
use aphrody_proc::NoWindow as _;
use serde_json::{Value, json};
use std::fs;
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const LOOPBACK: &str = "127.0.0.1:22";

pub(super) struct Bootstrap {
    command: String,
    binary: PathBuf,
    config: PathBuf,
    original: Vec<u8>,
    replacement: Option<Vec<u8>>,
}

/// Only the ordinary Windows sshd service command is supported. Unknown switches may override
/// config/ports/authentication, so they must be reconciled by their owner rather than guessed.
fn service_paths(command: &str, program_data: &Path) -> Result<(PathBuf, PathBuf)> {
    fn argument(text: &str) -> Result<(&str, &str)> {
        let text = text.trim_start();
        if let Some(quoted) = text.strip_prefix('"') {
            let end = quoted.find('"').context("commande sshd: guillemet non fermé")?;
            let rest = &quoted[end + 1..];
            if !rest.is_empty() && !rest.starts_with(char::is_whitespace) {
                bail!("commande sshd: séparateur d'argument absent");
            }
            return Ok((&quoted[..end], rest));
        }
        let end = text.find(char::is_whitespace).unwrap_or(text.len());
        Ok((&text[..end], &text[end..]))
    }
    let expanded = crate::wintask::expand_env(command);
    let (binary, rest) = argument(&expanded)?;
    let binary = PathBuf::from(binary);
    if !binary.is_absolute()
        || !binary.file_name().is_some_and(|s| s.to_string_lossy().eq_ignore_ascii_case("sshd.exe"))
    {
        bail!("sshd: exécutable de service non standard; correction par son propriétaire requise");
    }
    let config = if rest.trim().is_empty() {
        program_data.join("ssh").join("sshd_config")
    } else {
        let (flag, rest) = argument(rest)?;
        let (config, rest) = argument(rest)?;
        if flag != "-f" || config.is_empty() || !rest.trim().is_empty() {
            bail!("sshd: options de service non prises en charge; configuration laissée intacte");
        }
        PathBuf::from(config)
    };
    if !config.is_absolute() {
        bail!("sshd: la configuration du service doit être absolue");
    }
    Ok((binary, config))
}

fn has_loopback(effective: &str) -> bool {
    effective.lines().any(|line| {
        let mut words = line.split_whitespace();
        words.next().is_some_and(|w| w.eq_ignore_ascii_case("listenaddress"))
            && words.next().is_some_and(|w| {
                matches!(w, "127.0.0.1:22" | "[127.0.0.1]:22" | "0.0.0.0:22" | "[0.0.0.0]:22")
            })
    })
}

fn with_loopback(original: &[u8]) -> Result<Vec<u8>> {
    let text = std::str::from_utf8(original).context("sshd_config doit être UTF-8")?;
    let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
    // Always global: appending after a Match would change semantics or be rejected by sshd.
    let (bom, body) = text.strip_prefix('\u{feff}').map_or(("", text), |s| ("\u{feff}", s));
    Ok(format!("{bom}ListenAddress {LOOPBACK}{newline}{body}").into_bytes())
}

fn digest(bytes: &[u8]) -> String {
    ring::digest::digest(&ring::digest::SHA256, bytes)
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn sshd_output(binary: &Path, config: &Path, mode: &str) -> Result<String> {
    let mut child = std::process::Command::new(binary)
        .no_window()
        .args([mode, "-f"])
        .arg(config)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .context("validation native sshd impossible")?;
    let output = child.stdout.take().context("sortie sshd indisponible")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        output.take(1024 * 1024).read_to_end(&mut bytes).map(|_| bytes)
    });
    let deadline = Instant::now() + Duration::from_secs(15);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            Ok(None) => break Err(anyhow::anyhow!("validation sshd: délai dépassé")),
            Err(error) => break Err(error.into()),
        }
    };
    if status.is_err() {
        let _kill = child.kill();
        let _reap = child.wait();
    }
    let bytes = reader.join().map_err(|_| anyhow::anyhow!("lecture sshd interrompue"))??;
    if !status?.success() {
        // Diagnostics can contain auth directives or paths: never forward config output.
        bail!("sshd {mode}: configuration ou clés hôte invalides (diagnostic non exposé)");
    }
    String::from_utf8(bytes).context("sortie sshd non UTF-8")
}

impl Bootstrap {
    pub(super) fn inspect() -> Result<Self> {
        let command = crate::winsvc::image_command("sshd")?
            .context("service sshd absent: installer OpenSSH Windows par son propriétaire")?;
        let program_data = std::env::var_os("ProgramData")
            .map(PathBuf::from)
            .context("ProgramData absent: configuration sshd non résolue")?;
        let (binary, config) = service_paths(&command, &program_data)?;
        if !binary.is_file()
            || !config.is_file()
            || fs::symlink_metadata(&config)?.file_type().is_symlink()
        {
            bail!("sshd: exécutable/configuration installé absent ou configuration symbolique");
        }
        let original = fs::read(&config).context("configuration sshd illisible")?;
        sshd_output(&binary, &config, "-t")?;
        let effective = sshd_output(&binary, &config, "-T")?;
        let replacement =
            (!has_loopback(&effective)).then(|| with_loopback(&original)).transpose()?;
        Ok(Self { command, binary, config, original, replacement })
    }

    pub(super) fn report(&self) -> Value {
        json!({
            "service": "sshd", "executable": self.binary, "config": self.config,
            "startMode": "Auto", "restartOnFailure": true, "loopback": LOOPBACK,
            "addGlobalLoopback": self.replacement.is_some(),
            "validation": "sshd -t passed; local SSH banner checked only on apply",
            "backup": "checksum verified; same DACL, retained in configuration store",
        })
    }

    pub(super) fn apply(self) -> Result<Value> {
        if crate::winsvc::image_command("sshd")?.as_deref() != Some(self.command.as_str()) {
            bail!("commande sshd modifiée depuis le plan; aucun changement appliqué");
        }
        let backup = apply_config(
            &self.config,
            &self.original,
            self.replacement.as_deref(),
            |path| sshd_output(&self.binary, path, "-t").map(|_| ()),
            |changed| {
                crate::winsvc::ensure("sshd", true)?;
                if changed {
                    crate::winsvc::restart("sshd")?;
                }
                probe_loopback()
            },
        )?;
        Ok(json!({
            "service": "sshd", "startMode": "Auto", "restartOnFailure": true,
            "loopback": LOOPBACK, "sshBanner": "verified", "configChanged": self.replacement.is_some(),
            "backup": backup, "originalSha256": digest(&self.original),
        }))
    }
}

fn probe_loopback() -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(15);
    let address = LOOPBACK.parse().expect("constant socket address");
    loop {
        if let Ok(mut stream) =
            std::net::TcpStream::connect_timeout(&address, Duration::from_millis(500))
        {
            stream.set_read_timeout(Some(Duration::from_millis(1000)))?;
            let mut banner = [0u8; 256];
            if stream.read(&mut banner).is_ok_and(|n| banner[..n].starts_with(b"SSH-2.0-")) {
                return Ok(());
            }
        }
        if Instant::now() >= deadline {
            bail!("sshd: aucune bannière SSH locale vérifiée sur {LOOPBACK}");
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn sibling(path: &Path, suffix: &str) -> Result<PathBuf> {
    let name = path.file_name().context("configuration sans nom")?.to_string_lossy();
    Ok(path.with_file_name(format!("{name}.aphrody-{suffix}")))
}

fn temporary(path: &Path) -> Result<PathBuf> {
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_nanos();
    sibling(path, &format!("{}-{nonce}.tmp", std::process::id()))
}

#[cfg(not(windows))]
fn copy_protected(source: &Path, target: &Path) -> Result<()> {
    let bytes = fs::read(source)?;
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(target)?;
    file.set_permissions(fs::metadata(source)?.permissions())?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    Ok(())
}

#[cfg(windows)]
fn security_descriptor(path: &Path) -> Result<(Vec<u64>, Vec<u8>)> {
    use std::os::windows::ffi::OsStrExt as _;
    use windows_sys::Win32::Security::{
        DACL_SECURITY_INFORMATION, GetFileSecurityW, GetSecurityDescriptorDacl,
    };
    let wide = path.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
    let mut needed = 0;
    // SAFETY: size-only query, NUL-terminated path, live size pointer.
    unsafe {
        GetFileSecurityW(
            wide.as_ptr(),
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            0,
            &raw mut needed,
        )
    };
    if needed == 0 {
        bail!("DACL sshd indisponible: {}", std::io::Error::last_os_error());
    }
    let mut descriptor = vec![0u64; (needed as usize).div_ceil(8)];
    // SAFETY: aligned descriptor has at least needed bytes and remains live during all calls.
    let security = descriptor.as_mut_ptr().cast();
    if unsafe {
        GetFileSecurityW(
            wide.as_ptr(),
            DACL_SECURITY_INFORMATION,
            security,
            needed,
            &raw mut needed,
        )
    } == 0
    {
        bail!("lecture DACL sshd impossible: {}", std::io::Error::last_os_error());
    }
    let mut present = 0;
    let mut defaulted = 0;
    let mut dacl = std::ptr::null_mut();
    // SAFETY: security is the valid descriptor just filled by GetFileSecurityW.
    if unsafe {
        GetSecurityDescriptorDacl(security, &raw mut present, &raw mut dacl, &raw mut defaulted)
    } == 0
        || present == 0
        || dacl.is_null()
    {
        bail!("DACL sshd absente; aucune sauvegarde permissive créée");
    }
    // SAFETY: the descriptor owns the complete ACL pointed to by dacl, including its AclSize bytes.
    let bytes =
        unsafe { std::slice::from_raw_parts(dacl.cast::<u8>(), usize::from((*dacl).AclSize)) }
            .to_vec();
    Ok((descriptor, bytes))
}

#[cfg(windows)]
fn copy_protected(source: &Path, target: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt as _;
    use std::os::windows::io::FromRawHandle as _;
    use windows_sys::Win32::Foundation::{GENERIC_WRITE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Security::{
        SE_DACL_PROTECTED, SECURITY_ATTRIBUTES, SetSecurityDescriptorControl,
    };
    use windows_sys::Win32::Storage::FileSystem::{CREATE_NEW, CreateFileW, FILE_ATTRIBUTE_NORMAL};
    let target_wide = target.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
    let (mut descriptor, original_dacl) = security_descriptor(source)?;
    let security = descriptor.as_mut_ptr().cast();
    // SAFETY: protect the copied DACL from inheritance before file creation; no original ACL changes.
    if unsafe { SetSecurityDescriptorControl(security, SE_DACL_PROTECTED, SE_DACL_PROTECTED) } == 0
    {
        bail!("protection DACL sauvegarde impossible");
    }
    let attributes = SECURITY_ATTRIBUTES {
        nLength: u32::try_from(size_of::<SECURITY_ATTRIBUTES>()).unwrap_or(u32::MAX),
        lpSecurityDescriptor: security,
        bInheritHandle: 0,
    };
    // SAFETY: all paths/attributes live through CreateFileW; CREATE_NEW never overwrites a file.
    let handle = unsafe {
        CreateFileW(
            target_wide.as_ptr(),
            GENERIC_WRITE,
            0,
            &attributes,
            CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        bail!("création sauvegarde sshd impossible: {}", std::io::Error::last_os_error());
    }
    // SAFETY: unique owned handle from CreateFileW, closed once by File.
    let mut file = unsafe { fs::File::from_raw_handle(handle) };
    // Check before copying any config bytes: an EFS/unsupported-filesystem inheritance override
    // must fail with an empty file, never a more permissive backup containing authentication data.
    if security_descriptor(target)?.1 != original_dacl {
        drop(file);
        let _cleanup = fs::remove_file(target);
        bail!("DACL copie sshd différente de la configuration originale");
    }
    file.write_all(&fs::read(source)?)?;
    file.sync_all()?;
    Ok(())
}

fn verify_protection(source: &Path, target: &Path) -> Result<()> {
    #[cfg(windows)]
    if security_descriptor(source)?.1 != security_descriptor(target)?.1 {
        bail!("DACL sauvegarde sshd différente; remplacement refusé");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        if fs::metadata(source)?.permissions().mode() != fs::metadata(target)?.permissions().mode()
        {
            bail!("permissions sauvegarde sshd différentes; remplacement refusé");
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(target: &Path, candidate: &Path) -> Result<()> {
    fs::rename(candidate, target).context("remplacement configuration sshd")
}

#[cfg(windows)]
fn replace_file(target: &Path, candidate: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt as _;
    use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;
    let wide = |p: &Path| p.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
    let target = wide(target);
    let candidate = wide(candidate);
    // SAFETY: same-directory files, live NUL-terminated paths. Flags=0 preserves the original DACL
    // and fails instead of ignoring ACL/metadata merge errors. The external backup is never consumed.
    if unsafe {
        ReplaceFileW(
            target.as_ptr(),
            candidate.as_ptr(),
            std::ptr::null(),
            0,
            std::ptr::null(),
            std::ptr::null(),
        )
    } == 0
    {
        bail!("remplacement sshd impossible: {}", std::io::Error::last_os_error());
    }
    Ok(())
}

fn restore(target: &Path, backup: &Path, original: &[u8]) -> Result<()> {
    if fs::read(backup)? != original {
        bail!("checksum sauvegarde sshd invalide; restauration refusée");
    }
    if !target.exists() {
        // ReplaceFileW error 1176 can leave the original absent. A second replacement alone fails.
        copy_protected(backup, target)?;
    } else {
        let candidate = temporary(target)?;
        copy_protected(backup, &candidate)?;
        if let Err(error) = replace_file(target, &candidate) {
            let _cleanup = fs::remove_file(&candidate);
            return Err(error);
        }
    }
    if fs::read(target)? != original {
        bail!("restauration sshd: checksum différent");
    }
    Ok(())
}

fn apply_config(
    path: &Path,
    original: &[u8],
    replacement: Option<&[u8]>,
    mut validate: impl FnMut(&Path) -> Result<()>,
    mut activate: impl FnMut(bool) -> Result<()>,
) -> Result<Option<PathBuf>> {
    if fs::read(path)? != original {
        bail!("sshd_config modifié depuis le plan; aucun changement appliqué");
    }
    let Some(replacement) = replacement else {
        validate(path)?;
        activate(false)?;
        return Ok(None);
    };
    let backup = sibling(path, &format!("{}.bak", digest(original)))?;
    if !backup.exists() {
        copy_protected(path, &backup)?;
    }
    if fs::symlink_metadata(&backup)?.file_type().is_symlink() || fs::read(&backup)? != original {
        bail!("sauvegarde sshd non vérifiée; aucun changement appliqué");
    }
    verify_protection(path, &backup)?;
    let candidate = temporary(path)?;
    copy_protected(path, &candidate)?;
    let before_replace = (|| -> Result<()> {
        let mut file = fs::OpenOptions::new().write(true).truncate(true).open(&candidate)?;
        file.write_all(replacement)?;
        file.sync_all()?;
        validate(&candidate)?;
        if fs::read(path)? != original {
            bail!("sshd_config a changé pendant la validation; remplacement refusé");
        }
        Ok(())
    })();
    if let Err(error) = before_replace {
        let _cleanup = fs::remove_file(&candidate);
        return Err(error);
    }
    let activated = replace_file(path, &candidate).and_then(|()| {
        if fs::read(path)? != replacement {
            bail!("sshd_config: remplacement non vérifié");
        }
        activate(true)
    });
    if let Err(error) = activated {
        let _cleanup = fs::remove_file(&candidate);
        let rollback = restore(path, &backup, original)
            .and_then(|()| validate(path))
            .and_then(|()| activate(true));
        return match rollback {
            Ok(()) => Err(error.context("configuration sshd restaurée et service relancé")),
            Err(_) => Err(error.context(format!(
                "restauration sshd incomplète; sauvegarde vérifiée: {}",
                backup.display()
            ))),
        };
    }
    Ok(Some(backup))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effective_listener_checks_the_address_and_exact_port() {
        assert!(has_loopback("port 22\nlistenaddress 127.0.0.1:22\n"));
        assert!(has_loopback("listenaddress 0.0.0.0:22\n"));
        assert!(!has_loopback("listenaddress 10.200.77.10:22\nlistenaddress 127.0.0.1:2222\n"));
        assert!(!has_loopback("listenaddress [::]:22\n"));
    }

    #[test]
    fn new_bind_is_global_and_authentication_is_byte_preserved() {
        let original = b"# shared SSH\r\nPort 2222\r\nListenAddress 10.200.77.10\r\nInclude sshd_config.d/*.conf\r\nPasswordAuthentication no\r\nPubkeyAuthentication yes\r\nMatch Group administrators\r\n    AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys\r\n";
        let candidate = with_loopback(original).unwrap();
        assert_eq!(&candidate[b"ListenAddress 127.0.0.1:22\r\n".len()..], original);
        assert!(candidate.starts_with(b"ListenAddress 127.0.0.1:22\r\n# shared SSH"));
        assert!(!candidate.windows(b"0.0.0.0".len()).any(|w| w == b"0.0.0.0"));
        assert!(with_loopback(&[0xff, 0xfe]).is_err());
    }

    #[test]
    fn default_and_explicit_service_config_are_resolved_without_guessing_switches() {
        let root = tempfile::tempdir().unwrap();
        let binary = root.path().join("sshd.exe");
        let config = root.path().join("custom config");
        let command = format!("\"{}\"", binary.display());
        assert_eq!(
            service_paths(&command, root.path()).unwrap().1,
            root.path().join("ssh/sshd_config")
        );
        assert_eq!(
            service_paths(&format!("{command} -f \"{}\"", config.display()), root.path())
                .unwrap()
                .1,
            config
        );
        assert!(service_paths(&format!("{command} -p 22"), root.path()).is_err());
        assert!(service_paths(&format!("{command} -f relative"), root.path()).is_err());
        assert!(service_paths("powershell.exe hidden-ssh", root.path()).is_err());
    }

    #[test]
    fn invalid_candidate_is_rejected_before_service_changes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sshd_config");
        fs::write(&path, b"original").unwrap();
        let mut activated = false;
        let result = apply_config(
            &path,
            b"original",
            Some(b"bad config"),
            |_| bail!("invalid"),
            |_| {
                activated = true;
                Ok(())
            },
        );
        assert!(result.is_err());
        assert!(!activated);
        assert_eq!(fs::read(path).unwrap(), b"original");
    }

    #[test]
    fn failed_listener_restores_original_config_and_reactivates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sshd_config");
        let original =
            b"PasswordAuthentication no\nMatch User omara\n AuthorizedKeysFile original\n";
        fs::write(&path, original).unwrap();
        let mut activations = 0;
        let result = apply_config(
            &path,
            original,
            Some(&with_loopback(original).unwrap()),
            |_| Ok(()),
            |changed| {
                assert!(changed);
                activations += 1;
                if activations == 1 {
                    bail!("bind failed")
                };
                Ok(())
            },
        );
        assert!(result.unwrap_err().to_string().contains("restaurée"));
        assert_eq!(activations, 2);
        assert_eq!(fs::read(&path).unwrap(), original);
        let backup = sibling(&path, &format!("{}.bak", digest(original))).unwrap();
        assert_eq!(fs::read(backup).unwrap(), original);
    }

    #[test]
    fn restore_handles_missing_original_after_replace_failure() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sshd_config");
        let backup = dir.path().join("verified.bak");
        fs::write(&backup, b"protected original").unwrap();
        restore(&path, &backup, b"protected original").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"protected original");
        fs::write(&backup, b"corrupt").unwrap();
        assert!(restore(&path, &backup, b"protected original").is_err());
        assert_eq!(fs::read(path).unwrap(), b"protected original");
    }

    #[test]
    fn existing_loopback_does_not_replace_config_or_restart_listener() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sshd_config");
        fs::write(&path, b"unchanged").unwrap();
        let result = apply_config(
            &path,
            b"unchanged",
            None,
            |_| Ok(()),
            |changed| {
                assert!(!changed);
                Ok(())
            },
        )
        .unwrap();
        assert!(result.is_none());
        assert_eq!(fs::read(path).unwrap(), b"unchanged");
    }

    #[test]
    fn stale_plan_or_bad_backup_cannot_overwrite_current_auth() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sshd_config");
        fs::write(&path, b"new auth").unwrap();
        assert!(
            apply_config(&path, b"old auth", Some(b"candidate"), |_| Ok(()), |_| Ok(())).is_err()
        );
        let backup = sibling(&path, &format!("{}.bak", digest(b"new auth"))).unwrap();
        fs::write(backup, b"corrupt backup").unwrap();
        assert!(
            apply_config(&path, b"new auth", Some(b"candidate"), |_| Ok(()), |_| Ok(())).is_err()
        );
        assert_eq!(fs::read(path).unwrap(), b"new auth");
    }

    #[cfg(unix)]
    #[test]
    fn identical_backup_bytes_with_wider_permissions_are_rejected() {
        use std::os::unix::fs::PermissionsExt as _;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sshd_config");
        fs::write(&path, b"private auth policy").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        let backup = sibling(&path, &format!("{}.bak", digest(b"private auth policy"))).unwrap();
        fs::write(&backup, b"private auth policy").unwrap();
        fs::set_permissions(&backup, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(
            apply_config(&path, b"private auth policy", Some(b"candidate"), |_| Ok(()), |_| Ok(()))
                .is_err()
        );
        assert_eq!(fs::read(&path).unwrap(), b"private auth policy");
        assert_eq!(fs::metadata(path).unwrap().permissions().mode() & 0o777, 0o600);
    }
}
