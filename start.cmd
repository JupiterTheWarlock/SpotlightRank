@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or newer from https://nodejs.org/ then run this file again.
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 22 or newer is required. Please update Node.js and retry.
  pause
  exit /b 1
)
echo Spotlight Rank: http://127.0.0.1:4178
echo Keep this window open while using the site. Press Ctrl+C to stop.
node server.mjs
pause
