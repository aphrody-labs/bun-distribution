@echo off
rem Tunnel loopback vers le hub VPS (A2A 24888->23888, MCP 24889->23889). Lance par la tache planifiee \Aphrody\Native\hub-tunnel.
set "PATH=C:\Program Files\OpenSSH;%SystemRoot%\System32;%SystemRoot%;%PATH%"
set "APHRODY_TUNNEL_ROOT=%APHRODY_WORKSPACE_ROOT%"
if not defined APHRODY_TUNNEL_ROOT for %%I in ("%~dp0..\..") do set "APHRODY_TUNNEL_ROOT=%%~fI"
cd /d "%APHRODY_TUNNEL_ROOT%" || exit /b 1
"%LOCALAPPDATA%\Aphrody\bin\aphrody.exe" infra ssh tunnel --catalog "%APHRODY_TUNNEL_ROOT%\tools\config\hub-tunnel-catalog.json" --services vps-hub-a2a,vps-hub-mcp --offset 1000 >> "%USERPROFILE%\.aphrody\logs\hub-tunnel.log" 2>&1
