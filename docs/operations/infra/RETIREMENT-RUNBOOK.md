# VPS retirement and cutover runbook

This is a controlled runbook, not an executable purge script. It must be applied only after an encrypted backup, a replacement health probe and a rollback release have been observed.

## Preflight

1. Confirm the exact host alias and current commit.
2. Export databases with native tools to encrypted operator-controlled storage; never copy secrets into Git.
3. Record checksums without printing contents.
4. Verify health and public routes for the replacement workloads authorized by
   the current root catalogs. The historical `aphrody-site` replacement plane
   is marked retired; it is not a current cutover target.
5. Confirm disk capacity; the source VPS was observed at 89% root usage.

## Cutover

Install a versioned release, switch the `current` link atomically, reload the existing supervisor, then probe all routes and logs. Keep the previous release available for rollback.

## Retirement

Only after the observation window succeeds: disable named legacy units one at a time, re-read health after each change, and remove obsolete files only from an explicitly recorded allowlist. Do not remove `<repo>`, databases or credentials until retention and restore evidence are recorded.

## Rollback

Restore the previous `current` release, reload the supervisor and verify the same probes. If the old release is unavailable, stop the retirement sequence.
