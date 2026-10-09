@echo off
setlocal
set "REAL_CODEX=C:\Users\aphro\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe"
net session >nul 2>&1
if %errorlevel% == 0 (
    echo %* | findstr /i /c:"--no-daemon" >nul 2>&1
    if errorlevel 1 (
        "%REAL_CODEX%" --no-daemon %*
        goto :eof
    )
)
"%REAL_CODEX%" %*
