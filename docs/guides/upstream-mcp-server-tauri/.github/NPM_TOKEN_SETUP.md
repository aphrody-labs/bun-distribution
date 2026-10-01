# NPM Token Setup for GitHub Actions

This guide explains how to set up npm authentication tokens that comply with npm's new security requirements (as of September 2024).

## Required Token Type

You must use a **Granular Access Token** with the following configuration:

### 1. Create a Granular Access Token

1. Go to `https://www.npmjs.com/settings/[your-username]/tokens`
2. Click "Generate New Token" → "Granular Access Token"
3. Configure the token:
   * **Token name**: `github-actions-mcp-server-tauri`
   * **Expiration**: 90 days (or your preference)
   * **Packages and scopes**:
      * Select "Read and write"
      * Add packages: `@hypothesi/tauri-mcp-server` and `@hypothesi/tauri-plugin-mcp-bridge`
   * **Organizations**: Add any orgs if needed
   * **IP ranges (CIDR)**: Add GitHub Actions IP ranges for extra security (optional but recommended)

### 2. Configure CIDR Restrictions (Recommended)

For enhanced security, restrict the token to GitHub Actions IP addresses:

```text
# GitHub Actions IP ranges (may change - verify at https://api.github.com/meta)
140.82.112.0/20
143.55.64.0/20
185.199.108.0/22
192.30.252.0/22
```

### 3. Add Token to GitHub Secrets

1. Go to your repository settings
2. Navigate to Secrets and variables → Actions
3. Add a new repository secret:
   * Name: `NPM_TOKEN`
   * Value: Your granular access token (starts with `npm_`)

## Provenance Attestation

All workflows are configured to use `--provenance` flag when publishing, which:

   * Creates a signed attestation linking the package to its source repository
   * Shows a "Published from GitHub Actions" badge on npm
   * Requires `id-token: write` permission (already configured)

## Token Permissions Required

The token needs these permissions:

   * **Read** access to read package metadata
   * **Write** access to publish new versions
   * **Automation** tokens are recommended for CI/CD

## Security Best Practices

1. **Use Granular Tokens**: Classic tokens are deprecated
2. **Set Expiration**: Use 90-day expiration and rotate regularly
3. **Enable 2FA**: Required for publishing
4. **Use CIDR Restrictions**: Limit to GitHub Actions IPs
5. **Enable Provenance**: Already configured with `--provenance` flag

## Troubleshooting

If publishing fails with authentication errors:

1. **Verify token type**: Must be Granular Access Token (not Classic)
2. **Check permissions**: Token must have write access to the packages
3. **Verify 2FA**: Your npm account must have 2FA enabled
4. **Check expiration**: Tokens expire, check if renewal is needed
5. **CIDR restrictions**: If set, ensure GitHub Actions IPs haven't changed

## References

   * [npm's announcement on token changes](https://github.blog/changelog/2024-09-29-strengthening-npm-security-important-changes-to-authentication-and-token-management/)
   * [npm docs on access tokens](https://docs.npmjs.com/about-access-tokens)
   * [GitHub Actions IP addresses](https://docs.github.com/en/actions/using-github-hosted-runners/about-github-hosted-runners#ip-addresses)
