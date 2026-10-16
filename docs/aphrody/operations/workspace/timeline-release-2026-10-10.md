<!-- SPDX-License-Identifier: Apache-2.0 -->
# Timeline current-source release, 2026-10-10

The clean producer passed twelve native Bun tests / 78 assertions, scoped TypeScript, oxlint and oxfmt. Its content differs from published 0.1.0, so the owner workflow planned then published 0.1.1 to the existing public registry. The post-publication archive checksum matches the producer (current).

An isolated consumer installed exactly @aphrody/timeline 0.1.1 from npm. Real GraphQL query, SQL export and Bun HTTP health behavior returned TIMELINE_REGISTRY_CONSUMER_PASS. Consumer state remains outside the repository.

Registry integrity: `sha512-hcawKXeZMES+ZBBI1QT+jqw9Q/Ykc5dY+yDcSD83X5qKQ7KjLYY50Eh99yKWr9lLSDUV8M79YTy8K0qyktffeQ==`. No live domain data was collected, no services were restarted, and the concurrent shared lockfile was preserved. Full m3 and remaining producer releases are still separate pending batches.
