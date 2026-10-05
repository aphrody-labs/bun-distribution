
// SPDX-License-Identifier: MIT OR Apache-2.0
// bun:test shares one module registry per process, so mock.module() overrides leak between
// files (vitest isolates per file). Run each test file in its own `bun test` process.
const files = [...new Bun.Glob('tests/**/*.test.{ts,tsx}').scanSync('.')].toSorted()
const extra = Bun.argv.slice(2)
let failed = 0
for (const file of files) {
  const proc = Bun.spawn([process.execPath, 'test', '--timeout', '8000', ...extra, file], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if ((await proc.exited) !== 0) failed++
}
console.log(`\n${files.length - failed}/${files.length} test files passed`)
process.exit(failed ? 1 : 0)
