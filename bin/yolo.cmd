@echo off
setlocal
rem `yolo mcp` is an alias of `aphrody mcp-server`: run it without loading the yolo dispatcher first.
if "%~1"=="mcp" if "%~2"=="" (
  if defined APHRODY_BIN ("%APHRODY_BIN%" mcp-server) else (aphrody mcp-server)
  exit /b %ERRORLEVEL%
)
bun run "%~dp0..\packages\engine\yolo\src\index.ts" %*
