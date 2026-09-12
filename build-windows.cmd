@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missingnode
node -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
if errorlevel 1 goto missingnode
set "ELECTRON_CACHE=%~dp0.build-cache\electron"
set "ELECTRON_BUILDER_CACHE=%~dp0.build-cache\electron-builder"
echo [1/4] Installing build dependencies. Internet access is required.
call npm install --cache "%~dp0.build-cache\npm"
if errorlevel 1 goto failed
echo [2/4] Checking TypeScript.
call npm run typecheck
if errorlevel 1 goto failed
echo [3/4] Running core tests.
call npm test
if errorlevel 1 goto failed
echo [4/4] Building the Windows installer.
call npm run dist
if errorlevel 1 goto failed
echo Installer created in the release folder.
echo The installer and OCR still require the checks in ACCEPTANCE.md.
pause
exit /b 0
:missingnode
echo Install Node.js 24 or newer before building.
pause
exit /b 1
:failed
echo Build stopped. Review the error above. No success is being reported.
pause
exit /b 1
