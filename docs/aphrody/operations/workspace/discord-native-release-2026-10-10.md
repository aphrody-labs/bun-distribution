<!-- SPDX-License-Identifier: Apache-2.0 -->
# Discord native release, 2026-10-10

The compile API now returns Bun actual entry-point output, including the Windows .exe suffix. Windows process supervision now uses the existing proc owner Job Object through the unchanged C ABI, so independent descendants stop with their owner. Unix retains its existing graceful group shutdown; Windows uses the documented termination code 1.

Native MSVC check, eighteen runtime tests and strict all-targets Clippy pass. The rebuilt FFI debug artifact was used explicitly for fifty-six Discord tests / 171 assertions, including native compiled execution, profile isolation, Bun descendant shutdown and an independent PowerShell process tree. Scoped TypeScript, oxlint and oxfmt pass. The library is a qualified shared-tree debug artifact, not a published runtime release: SHA-256 390e2708ccbfc0bd746457a33a88b9b90817dc07ae3acae6f07f1b15303d45dc.

The owner publisher planned then submitted discord-kit0.1.3. Its first visibility check was unverified; a later fresh-cache public check matched the producer archive exactly (current). An isolated npm consumer installed exactly 0.1.3, compiled and ran an actual native executable with the qualified DLL, preserved the selected profile, and rejected the parent workspace override: DISCORD_REGISTRY_NATIVE_CONSUMER_PASS. No Discord messages or provider sessions were used. Windows runtime artifact installation/distribution remains a separate release requirement.
