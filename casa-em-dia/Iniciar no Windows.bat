@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale primeiro o Node.js 24 LTS: https://nodejs.org/pt
  echo Depois, abra este arquivo novamente.
  pause
  exit /b 1
)
node iniciar.mjs
pause
