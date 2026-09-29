<!-- SPDX-License-Identifier: Apache-2.0 -->
# GitHub ownership migration

Observed 2026-09-29 with `gh repo list aphrody-labs`: [`aphrody-labs`](https://github.com/aphrody-labs) contains private `aphrody-koharu` and five public GNU fork repositories (`tar`, `sed`, `grep`, `findutils`, `diffutils`). [`aphrody-dev`](https://github.com/aphrody-dev) is its active owner; [`aphrody-code`](https://github.com/aphrody-code) is an active member. The other product source repositories remain under `aphrody-code` at this observation. The authenticated agent account is `aphrody-code` by default on the development hosts.

## Selected URL login

The confirmed organization login is **`aphrody-labs`**. It keeps the personal and agent account logins intact. `aphrody`, `aphrody-dev` and `aphrody-code` already belong to other account roles.

`gh` now authenticates both `aphrody-dev` and `aphrody-code` on WSL, the OVH VPS, DBFR and the Windows PC. The code account remains active on every host. Linux `gh` credential files are mode `600`; Windows `gh` stores both accounts in its keyring. Use `gh auth switch --hostname github.com --user aphrody-dev` only for owner work, then switch back to `aphrody-code`. No token value belongs in this repository.

No distinct organization login can keep `github.com/aphrody-code/REPO` as the canonical URL. The spelling of the replacement login does not reduce the number of source references to update. GitHub [redirects transferred repository URLs](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository), including Git fetch/push, until the old repository location is reused. Keep `aphrody-code` as the agent identity and leave old repository paths unused; update remotes and canonical URLs in a controlled batch.

| Surface | Verified current dependency | Transfer action |
| --- | --- | --- |
| Git push and source sync | Infra [`scripts/source-sync.ts`](../scripts/source-sync.ts) accepts only `github.com/aphrody-code/` as an owned remote. | Extend its owner check to the verified organization before changing each `origin`; retain the `aphrody-code` commit identity. Then inspect a dry run and push gate. |
| Deploy/source catalogues | Infra [`config/stack-training.json`](../config/stack-training.json) contains current repository source URLs; AI's package command also embeds Aphrody GitHub URLs. | Replace canonical source URLs only for repositories actually transferred; keep deployed service domains and release pins unchanged unless separately verified. |
| npm registry | Current package manifests include `@aphrody/n2b-*` and `@aphrody/bxc`; public npm currently resolves `@aphrody/x` and `@aphrody/bxc`. | Keep the `@aphrody` scope and package names. GitHub ownership does not rename an npm scope; update package `repository` metadata in a later verified publication. [npm scopes](https://docs.npmjs.com/about-scopes/) are registry identities, and [scoped packages cannot be transferred to another scope](https://docs.npmjs.com/transferring-a-package-from-a-user-account-to-another-user-account/). |
| GitHub Packages / GHCR | No package transfer result has been verified. | Inventory packages and links before transfer. [GitHub Packages](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages) may retain the old package owner but unlink a granular-permission package from a moved repository; repair permissions and image references explicitly. |
| GitHub Actions | The Bun lint job is configured, but its first run failed before a runner started due to the current account's billing lock. | Re-run under the organization; do not assume transfer repairs billing or makes CI green. |

## Intended roles

- `aphrody-dev`: human owner of the new organization and its billing, security and membership settings.
- `aphrody-code`: agent account, given only the repository access needed for development and CI operations. Its Git commit identity remains `aphrody-code <contact@aphrody.com>`; repository ownership and commit authorship are separate.
- Organization repositories: canonical source owners after transfer. Keep Bun's fork relationship with `oven-sh/bun`; do not replace it with a fresh standalone copy.

Do not grant organization owner rights to the agent account for routine repository work. GitHub's [organization roles](https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/roles-in-an-organization) and repository permissions should be checked against the actual plan and team structure when the organization exists.

## Transfer sequence

1. **Done:** `aphrody-dev` created `aphrody-labs`; the owner and member roles are active. Repository transfers have begun independently: `aphrody-koharu` and the five GNU forks are already listed there. Recheck settings and names before every further transfer.
2. **Pending:** transfer `aphrody-code/bun` to `aphrody-labs/bun` using GitHub's repository transfer flow. Verify that its `parent` is still `oven-sh/bun`, `main` has the exact prior commit, the ruleset still protects it, issue templates and disabled upstream workflows remain configured, and the source test evidence still applies to that commit. Afterward, scope `aphrody-code` access to the repositories it maintains.
3. Transfer other owner repositories in an explicit batch, starting with Infra and the Bun dependencies that are ready for organization ownership. Check each target for a name collision and record its exact GitHub head before transfer. Keep Aphrody UI under its designated agent's scope.
4. After each transfer, update Git `origin` URLs, Infra repository pins/catalogues, source references, GitHub Actions settings, secrets/webhooks, branch rules and package links. GitHub redirects old repository URLs, but the canonical URLs and local remotes must be updated. Do not create a new repository at an old location because that removes the redirect.
5. Re-run the Bun fork's local gate and a GitHub workflow on the new owner. The existing [GitHub Actions run](https://github.com/aphrody-code/bun/actions/runs/36481251183) failed before a runner started because GitHub reported an account billing lock. A transfer alone does not prove the new billing or Actions configuration works.

GitHub's [repository transfer rules](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository) say a public fork keeps its upstream association, repository settings and Git history on transfer, subject to the target account's permissions and conflicts. Repository links redirect, while package associations can require separate review. Verify those properties after the actual transfer instead of treating this plan as migration evidence.
