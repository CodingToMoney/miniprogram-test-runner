@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Please install Node.js 18+ first: https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm is not installed. Please reinstall Node.js with npm.
  pause
  exit /b 1
)

if not exist "node_modules\miniprogram-automator" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed. Check your network or npm registry.
    pause
    exit /b 1
  )
)

call npm run test
echo.
echo Report: %cd%\reports\index.html
pause
