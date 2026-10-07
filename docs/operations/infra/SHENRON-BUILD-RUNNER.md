# Shenron build factory runner

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
