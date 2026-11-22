@echo off
rem Runs sync-profiles.ps1 without changing the system-wide execution policy.
rem Prefers PowerShell 7 (pwsh); falls back to the built-in Windows PowerShell 5.1.
rem Usage: scripts\windows\sync-profiles.cmd export|import [-Select "1,3"|all]
set "PS_EXE=powershell.exe"
where pwsh.exe >nul 2>nul && set "PS_EXE=pwsh.exe"
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-profiles.ps1" %*
exit /b %ERRORLEVEL%
