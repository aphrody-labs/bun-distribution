// SPDX-License-Identifier: Apache-2.0
// GitHub release workflow: on a `v*` tag, every runner installs the Bun of the aphrody-labs fork with its
// install.sh (the runtime m3-bun is developed with), packages the app for each target with `m3-bun package`
// and attaches the archives and their SHA-256 to the GitHub release. The release scripts of the Bun repository
// (packages/bun-release) publish Bun itself and are not reused here.
import { GENERATED_NOTE } from "../util.ts";
import type { Target, TargetContext, TargetFile } from "./types.ts";

export const RELEASE_MATRIX = [
  { target: "linux-x64", os: "ubuntu-latest" },
  { target: "linux-x64-musl", os: "ubuntu-latest" },
  { target: "linux-arm64", os: "ubuntu-24.04-arm" },
  { target: "windows-x64", os: "ubuntu-latest" },
  { target: "darwin-arm64", os: "macos-latest" },
] as const;

/** The release tag of the aphrody-labs Bun fork for `version` (`aphrody-v1.4.3-aphrody.2`), when it is known. */
export function forkTag(version: string): string | undefined {
  if (version.includes("-aphrody.")) return `aphrody-v${version.replace(/^v/, "")}`;
  const running = /^v?(\d+\.\d+\.\d+-aphrody\.\d+)/.exec(
    (Bun as { version_with_sha?: string }).version_with_sha ?? "",
  )?.[1];
  return running?.startsWith(`${version}-`) ? `aphrody-v${running}` : undefined;
}

/** The fork install.sh takes a fork tag, or `X.Y.Z` for the newest fork build of it. */
export const forkBunVersion = (version: string): string => forkTag(version) ?? version;

export const releaseWorkflow = (c: TargetContext): string => `# ${GENERATED_NOTE}
# Release ${c.name}: \`git tag v${c.version} && git push --tags\`. Copy to .github/workflows/release.yml.
name: release
on:
  push:
    tags: ["v*"]
  workflow_dispatch:
permissions:
  contents: write
concurrency:
  group: release-\${{ github.ref }}
  cancel-in-progress: false
jobs:
  package:
    strategy:
      fail-fast: false
      matrix:
        include:
${RELEASE_MATRIX.map((m) => `          - { target: ${m.target}, os: ${m.os} }`).join("\n")}
    runs-on: \${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - name: Bun (aphrody-labs fork)
        run: |
          curl -fsSL https://raw.githubusercontent.com/aphrody-labs/bun/main/scripts/aphrody/install.sh | bash -s ${forkBunVersion(c.bunVersion)}
          echo "$HOME/.bun/bin" >> "$GITHUB_PATH"
        env:
          GITHUB_TOKEN: \${{ github.token }}
      - run: bun --revision
      - run: bun install --frozen-lockfile
      - run: bun test
        if: matrix.target == 'linux-x64'
      - name: Package \${{ matrix.target }}
        run: ${c.cli} package --target \${{ matrix.target }} --out release
      - uses: actions/upload-artifact@v4
        with:
          name: ${c.name}-\${{ matrix.target }}
          path: release/*
          if-no-files-found: error
  publish:
    needs: package
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: release
          merge-multiple: true
      - name: Checksums
        working-directory: release
        run: sha256sum $(ls | grep -v '\\.sha256$' | grep -v SHA256SUMS) > SHA256SUMS
      - name: GitHub release
        if: startsWith(github.ref, 'refs/tags/')
        run: gh release create "$GITHUB_REF_NAME" release/* --repo "$GITHUB_REPOSITORY" --title "${c.name} $GITHUB_REF_NAME" --generate-notes --verify-tag
        env:
          GH_TOKEN: \${{ github.token }}
`;

export const release: Target = {
  id: "release",
  title: "GitHub release",
  description:
    ".github/workflows/release.yml: fork Bun via install.sh, m3-bun package for each target, archives and SHA256SUMS on the GitHub release",
  generate(c): TargetFile[] {
    return [{ path: ".github/workflows/release.yml", content: releaseWorkflow(c) }];
  },
};
