# Releasing Packages

This monorepo supports independent versioning and releasing of each package. Each package
can be released separately with its own version number.

## Available Packages

   * **plugin** (`@hypothesi/tauri-plugin-mcp-bridge`): Tauri plugin published to both
     crates.io and npm
   * **server** (`@hypothesi/tauri-mcp-server`): MCP server published to npm only

## Release Process

### Prerequisites

1. **NPM Token**: Set up `NPM_TOKEN` secret in GitHub repository settings
2. **Cargo Token** (for plugin only): Set up `CARGO_REGISTRY_TOKEN` secret in GitHub
   repository settings
   * Get token from [crates.io settings](https://crates.io/settings/tokens)
   * Run `cargo login <token>` locally to test

### Manual Release

#### Release Plugin (Cargo + NPM)

```bash
# Release with specific version
npm run release:plugin 0.1.1

# Or auto-bump (patch, minor, or major)
npm run release:plugin patch
npm run release:plugin minor
npm run release:plugin major

# Dry run to test
npm run release:plugin 0.1.1 --dry-run
```

This will:

1. Update version in `Cargo.toml` and `package.json`
2. Build the TypeScript bindings
3. Publish to crates.io (if not dry-run)
4. Publish to npm (if not dry-run)
5. Create git tag: `tauri-plugin-mcp-bridge/v0.1.1`
6. Commit version changes

After running, push the tag:

```bash
git push origin tauri-plugin-mcp-bridge/v0.1.1
git push origin HEAD
```

GitHub Actions will automatically:

   * Create a GitHub release
   * Extract release notes from CHANGELOG.md

#### Release Server (NPM only)

```bash
# Release with specific version
npm run release:server 0.1.1

# Or auto-bump
npm run release:server patch

# Dry run
npm run release:server 0.1.1 --dry-run
```

This will:

1. Update version in `package.json`
2. Build the package
3. Run tests
4. Publish to npm (if not dry-run)
5. Create git tag: `mcp-server/v0.1.1`
6. Commit version changes

After running, push the tag:

```bash
git push origin mcp-server/v0.1.1
git push origin HEAD
```

## Updating CHANGELOG

Before releasing, update the CHANGELOG.md in the package directory:

```markdown
## [Unreleased]

## [0.1.1] - 2024-01-15

### Fixed

   * Fixed issue with IPC monitoring

### Changed

   * Improved error handling

```

The release script will extract the changelog entry for the version being released.

## Version Format

Versions follow [Semantic Versioning](https://semver.org/):

   * **MAJOR**: Breaking changes
   * **MINOR**: New features (backward compatible)
   * **PATCH**: Bug fixes (backward compatible)

## Tag Format

Tags follow the monorepo pattern:

   * `tauri-plugin-mcp-bridge/v0.1.1`
   * `mcp-server/v0.1.1`

This allows multiple packages to have independent version numbers while maintaining clear
organization.

## GitHub Releases

GitHub releases are automatically created by GitHub Actions when tags are pushed. Each
release includes:

   * Release notes extracted from CHANGELOG.md
   * Links to published packages (crates.io, npm)
   * Automatic changelog formatting

## Plugin Publishing Best Practices

The `tauri-plugin-mcp-bridge` package follows Tauri's recommended structure:

### Cargo Crate

   * Published to crates.io as `tauri-plugin-mcp-bridge`
   * Includes Rust source code and build scripts
   * README.md is included automatically

### NPM Package

   * Published to npm as `@hypothesi/tauri-plugin-mcp-bridge`
   * Includes TypeScript bindings in `dist-js/`
   * Type definitions in `dist-js/index.d.ts`
   * Source TypeScript in `guest-js/` for reference
   * `prepublishOnly` script ensures build runs before publish

### Package Structure

```text
tauri-plugin-mcp-bridge/
├── src/              # Rust plugin code
├── guest-js/         # TypeScript source
├── dist-js/          # Compiled JS + .d.ts (published)
├── Cargo.toml        # Rust crate config
├── package.json      # NPM package config
└── README.md         # Documentation
```

## Troubleshooting

### Cargo Publish Fails

   * Ensure you're logged in: `cargo login <token>`
   * Check that the crate name is available on crates.io
   * Verify all required metadata in `Cargo.toml`

### NPM Publish Fails

   * Ensure you're logged in: `npm login`
   * Check package name availability
   * Verify `files` array in `package.json` includes all necessary files
   * Ensure `dist-js/` is built before publishing

### GitHub Release Not Created

   * Verify the tag was pushed: `git push origin <tag>`
   * Check GitHub Actions workflow logs
   * Ensure repository secrets are configured
