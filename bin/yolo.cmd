@echo off
setlocal
rem Deprecated name of `aphrody` (bin\aphrody.ts): same arguments, same exit code.
echo yolo: deprecated, use `aphrody %*` 1>&2
bun run "%~dp0aphrody.ts" %*
