# Shenron build factory runner

## Verified activation, 2026-10-07

### Current VPS layout, 2026-10-12

The runner now lives at `/home/ubuntu/build/runners/shenron` and runs as `ubuntu:aphrody`,
as declared by `tools/config/host/vps/layout.json`. The former `/home/shenron-build/runner`
copy was removed during the 2026-10-09 migration; the `shenron-build` account remains but
does not run the service. Do not run the registration installer again: the current runner
registration is retained. Its systemd unit uses `Restart=always` with a 15-second delay so a
wrapper that exits successfully after a child failure cannot leave the runner stopped.

Runner `aphrody-vps-shenron` (repository runner ID 21) is registered, online, and
its canonical systemd service is enabled/active. Real trusted manual qualification
[run 37598615282](https://github.com/aphrody-labs/shenron/actions/runs/37598615282)
completed successfully on this named runner: non-root identity, Bun 1.4.2,
Cargo/Rust 1.98.1, Docker 29.1.3, Buildx 0.30.1 and Compose.
The existing `server-artifact.yml` now selects this actual factory, without a
second release pipeline. Hosted CI remains subject to the account billing block.
No complete application build or production promotion is established by this
toolchain qualification.

The runner account has its own copied precompiled Bun and rustup executables;
`factory-1.98.1` links the existing public VPS Rust toolchain. Credentials from
the Ubuntu account were not copied. Registration credentials stay protected
under its 0700 runner directory; the short-lived registration file was removed.
Automatic runner updates are disabled: upgrade the pinned official archive through
Infra and requalify before GitHub drops support for the installed runner version.

## Ownership and installation

Infra owns `aphrody-shenron-build-runner.service` on `vps`. The private repository
`aphrody-labs/shenron` owns its release workflow. DBFR hosts production; this runner
only builds. Its actual labels after registration are `self-hosted`, `Linux`,
`X64`, `shenron-factory`, and `vps`. Do not select these labels before registration
and a successful online-status check.

The dedicated non-root `shenron-build` account stores runner credentials and build
work under `/home/shenron-build`, on the VPS system disk. `/srv` was nearly full on
2026-10-07 and must not be the work directory. The account belongs to `docker`:
Docker daemon access is privileged host access, so schedule only trusted release
pushes/tags or manual jobs. Do not execute pull-request code on this factory.
Keep repository access private and require existing branch protections.

The installer pins GitHub Actions runner 2.338.0 and the official release asset
SHA256. Run it through native `aphrody infra ssh` after transferring the committed
installer and unit. Generate a short-lived repository registration token with
the authenticated GitHub API `POST /repos/aphrody-labs/shenron/actions/runners/registration-token`.
Transfer only its token value through authenticated SSH into a private 0600 file;
never print it, commit it, or pass it in a tool transcript. The installer consumes
and removes that file. It refuses replacing an existing registration and leaves
the installed service disabled/stopped for coordinated activation.

Verify the runner's installed runtime dependencies and install the repository's
pinned Bun/Rust toolchain under this account before using it for release builds.
Respect the existing Cargo factory locks and sccache policy. Docker builds require
live `docker buildx version` checks before a workflow assumes BuildKit tooling.
After qualification, enable/start through Infra; verify API online status and a
small trusted manual job before scheduling a full release. Stop and deregister
the repository runner before removing its account or protected credentials.

GitHub-hosted jobs currently fail before allocation due to account payments or
spending limits (verified check-run annotation 112684944500 on 2026-10-07).
A self-hosted runner avoids depending on GitHub-hosted compute capacity; verify
repository Actions policy and current billing independently. Registration alone
does not prove successful workflow execution.

Official references:

- <https://docs.github.com/en/actions/concepts/runners/self-hosted-runners>
- <https://docs.github.com/en/rest/actions/self-hosted-runners#create-a-registration-token-for-a-repository>
- <https://github.com/actions/runner/releases/tag/v2.338.0>

## Build image, 2026-10-08

The runner builds inside Aphrody's `aphrody-build:latest` image, not on the host toolchain: see
[SHENRON-DOCKER.md](SHENRON-DOCKER.md#builds-on-the-vps-the-aphrody-build-image). `shenron-build` was already in
the `docker` group (installer `usermod --append --groups docker`, unit `SupplementaryGroups=docker`); no host
change was required. The public VFS input of `server-artifact.yml` is staged at
`/home/shenron-build/data/shenron-vfs.public.sqlite` (owner `shenron-build`, 0644, SHA-256
`82b57dc12b921cb1f0ae13473051b552d4ab942e527dbfa4712074992704c7a7`, the public VFS of release `7b26187`); the
earlier runs 37634762086 and 37665743137 failed because the fresh checkout had no VFS.
