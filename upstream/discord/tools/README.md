# Compiler API tools

The workspace typechecks with TypeScript 7.0.2. TypeDoc 0.28.20 and tsup
declaration bundling still require the JavaScript compiler API. Their private
workspaces under `tools/` resolve `@typescript/typescript6` 6.0.2 as
`typescript`; the runner scripts preserve the calling package's working
directory and exit code. Package `typecheck` scripts continue to invoke the
root TypeScript 7 compiler.

`@discordjs/api-extractor` uses the compiler API in its own source and imports
`@typescript/typescript6` explicitly. Its TS 7 typecheck skips library checking
because the TS 6 and TS 7 standard library declarations both define `bold`.
This does not suppress errors in the package source.
