@echo off
setlocal
if "%~1"=="mcp" if "%~2"=="" (
  bun run "%~dp0..\packages\engine\yolo\src\mcp.ts"
  exit /b %ERRORLEVEL%
)
bun run "%~dp0aphrody.ts" %*
