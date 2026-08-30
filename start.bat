@echo off
rem Open the offline single-file build in your default browser.
rem No Node.js or internet connection required.
if not exist "%~dp0dist\index.html" (
  echo [!] dist\index.html not found. Run "npm run build" first to generate it.
  pause
  exit /b 1
)
start "" "%~dp0dist\index.html"
