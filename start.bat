@echo off
setlocal enabledelayedexpansion
title Notes to Sizing/POV

echo ============================================
echo   Notes to Sizing/POV
echo ============================================
echo.

REM --- Node.js check ---
where node >nul 2>nul
if errorlevel 1 goto :no_node

REM --- npm check ---
where npm >nul 2>nul
if errorlevel 1 goto :no_npm

REM --- Dependency check ---
set NEEDS_INSTALL=0
for %%D in (express express-session jszip mammoth mongodb multer pdf-parse tesseract.js xlsx) do (
    if not exist "node_modules\%%D" (
        echo [WARN] Missing dependency: %%D
        set NEEDS_INSTALL=1
    )
)
if "!NEEDS_INSTALL!"=="0" goto :deps_ok
echo.
echo [INFO] One or more dependencies are missing. Running npm install...
call npm install
if errorlevel 1 goto :npm_install_failed
:deps_ok

REM --- Ollama check ---
where ollama >nul 2>nul
if errorlevel 1 goto :ollama_not_found

:ollama_found
echo [INFO] Ollama found.
call ollama list 2>nul | findstr /C:"llama3.2:1b" >nul 2>nul
if errorlevel 1 goto :pull_model
echo [INFO] Default model llama3.2:1b already available.
goto :start_server

:pull_model
echo [INFO] Pulling default model llama3.2:1b ~1.3GB. This may take a while...
call ollama pull llama3.2:1b
if errorlevel 1 goto :pull_failed
echo [INFO] Model llama3.2:1b ready.
goto :start_server

:pull_failed
echo [WARN] Could not pull default model. You can pull it manually with: ollama pull llama3.2:1b
goto :start_server

:ollama_not_found
echo.
echo ----------------------------------------
echo  Ollama Setup
echo ----------------------------------------
echo  Ollama is required for the AI chat feature.
echo  It will be downloaded from ollama.com and installed.
echo  The default model ^(~1.3GB^) will also be
echo  downloaded so chat works immediately.
echo.
echo  Hardware requirements:
echo    Minimum: 8GB RAM
echo    Recommended: 16GB RAM
echo.
echo  If you choose not to install Ollama, you can still
echo  use a custom LLM endpoint by providing a URL and
echo  API key in the Settings page.
echo.
echo  You can also install Ollama manually from
echo  https://ollama.com/download if you prefer.
echo.
set /p INSTALL_OLLAMA="Do you want to install Ollama now? (y/n): "
if /i "!INSTALL_OLLAMA!"=="y" goto :install_ollama

:ollama_declined
echo.
echo [WARN] Ollama not installed.
echo         You can still use the app, but the chat feature will need
echo         a custom LLM endpoint configured in Settings
echo         ^(e.g., an OpenAI-compatible API URL^).
goto :start_server

:install_ollama
echo.
echo [INFO] Downloading Ollama installer...
powershell -Command "Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile 'OllamaSetup.exe' -UseBasicParsing"
if errorlevel 1 goto :download_failed
echo [INFO] Installing Ollama...
start /wait OllamaSetup.exe
if errorlevel 1 goto :install_failed
del OllamaSetup.exe >nul 2>nul
set "PATH=%PATH%;%LOCALAPPDATA%\Programs\Ollama"
echo [INFO] Ollama installed successfully.
goto :pull_model

:download_failed
echo [ERROR] Failed to download Ollama. Check your internet connection.
echo         You can install it manually from https://ollama.com/download
echo.
pause
exit /b 1

:install_failed
echo [ERROR] Ollama installation failed.
echo         You can install it manually from https://ollama.com/download
echo.
pause
exit /b 1

:no_node
echo [ERROR] Node.js was not found on your PATH.
echo         Please install Node.js from https://nodejs.org/ and re-run.
echo.
pause
exit /b 1

:no_npm
echo [ERROR] npm was not found on your PATH.
echo         Please install Node.js from https://nodejs.org/ and re-run.
echo.
pause
exit /b 1

:npm_install_failed
echo [ERROR] npm install failed. Check your internet connection and re-run.
echo.
pause
exit /b 1

:start_server
echo.
echo [INFO] Starting server on http://localhost:3000
echo [INFO] Press Ctrl+C to stop the server.
echo.
call npm start
endlocal
