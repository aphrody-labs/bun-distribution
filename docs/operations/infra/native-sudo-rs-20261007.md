<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native sudo-rs qualification, 2026-10-07

The owner requested native sudo-rs throughout the maintenance workflow.
Native Infra observations on VPS and DBFR confirmed that `/usr/bin/sudo`
already selects sudo-rs `0.2.13-0ubuntu1.2`; `/usr/bin/sudo-rs` is also present.
The [factory reclamation receipt](srv-reclaim-20261007.md) records its actual use.

WSL initially used original sudo `1.9.15p5`. The Ubuntu Noble sudo-rs package
`0.2.2-1` could execute the root probe but rejected an existing per-user Defaults
directive. No sudoers or PAM policy was changed to accommodate it.

The installed Ubuntu sudo-rs `0.2.13-0ubuntu1.2` binary was transferred from VPS
through native Aphrody SFTP and checksum-verified:

```text
SHA256 2eb5d31f91a12d75a2a05b54b7f79775e5565898af0b3263414fcabaad922afb
ELF required glibc maximum: 2.39
WSL glibc: 2.39
```

The qualified binary is root-owned, mode `4755`, at
`/usr/local/libexec/aphrody/sudo-rs-0.2.13-ubuntu`. New `/usr/local/bin/sudo`
and `/usr/local/bin/sudo-rs` links select it. Version, noninteractive root
identity and switching back to the owner account all passed without the older
parser error. Original `/usr/bin/sudo` and authentication policies remain intact.
The task-installed older sudo-rs package was removed after qualification.

The [official version-pinned source documentation](https://github.com/trifectatechfoundation/sudo-rs/blob/v0.2.13/README.md)
was fetched with Aphrody's native Web owner. It documents coexistence under
`/usr/local`, PAM requirements and differences from original sudo, including
unsupported `sudo -E` and syslog-based logging. This receipt qualifies the
observed commands and installed hosts; it does not claim every original sudo
option is supported.
