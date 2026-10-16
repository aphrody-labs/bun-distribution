# BEP package manager

`bep` means **Bun Engine Packages**. It is a three-letter executable that delegates directly to the package manager embedded in the Bun runtime; it does not implement another resolver, cache, registry client or lockfile.

```powershell
bep install --frozen-lockfile
bep add package --exact
bep pm ls
bun run bep:compile
```

The standalone executable re-enters its embedded Bun CLI with `BUN_BE_BUN=1`, preserving Bun's lockfile, workspace, catalog, trusted-dependency, cache and install behavior.
