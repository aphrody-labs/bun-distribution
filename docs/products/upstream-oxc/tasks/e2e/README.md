# End to End Integration Tests

Node.js runtime tests for transformer and minifier.

```
# From repo root
bun run --filter "./napi/minify" --filter "./napi/transform" run build-test
cd tasks/e2e
bun run test
```
