@echo off
REM Notes to Sizing/POV - one-step start script for Windows
cd /d "%~dp0"
echo Installing dependencies...
call npm install
echo Starting server...
call npm start
pause
