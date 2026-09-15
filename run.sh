#!/bin/bash
# Notes to Sizing/POV - Mac/Linux start script
# Checks deps, auto-installs Ollama, pulls default model

set -e
cd "$(dirname "$0")"

echo "============================================"
echo "  Notes to Sizing/POV"
echo "============================================"
echo

# --- Node.js check ---
if ! command -v node &>/dev/null; then
  echo "[ERROR] Node.js was not found on your PATH."
  echo "        Please install Node.js from https://nodejs.org/ and re-run."
  echo
  exit 1
fi

# --- npm check ---
if ! command -v npm &>/dev/null; then
  echo "[ERROR] npm was not found on your PATH."
  echo "        Please install Node.js from https://nodejs.org/ and re-run."
  echo
  exit 1
fi

# --- Dependency check ---
NEEDS_INSTALL=0
for dep in express express-session jszip mammoth mongodb multer pdf-parse tesseract.js xlsx; do
  if [ ! -d "node_modules/$dep" ]; then
    echo "[WARN] Missing dependency: $dep"
    NEEDS_INSTALL=1
  fi
done

if [ "$NEEDS_INSTALL" -eq 1 ]; then
  echo
  echo "[INFO] One or more dependencies are missing. Running npm install..."
  npm install
  echo
fi

# --- Ollama check ---
if command -v ollama &>/dev/null; then
  echo "[INFO] Ollama found."
  if ollama list 2>/dev/null | grep -q "llama3.2:1b"; then
    echo "[INFO] Default model llama3.2:1b already available."
  else
    echo "[INFO] Pulling default model llama3.2:1b (~1.3GB). This may take a while..."
    if ollama pull llama3.2:1b; then
      echo "[INFO] Model llama3.2:1b ready."
    else
      echo "[WARN] Could not pull default model. You can pull it manually with: ollama pull llama3.2:1b"
    fi
  fi
else
  echo
  echo "----------------------------------------"
  echo " Ollama Setup"
  echo "----------------------------------------"
  echo " Ollama is required for the AI chat feature."
  echo " It will be downloaded from ollama.com and installed."
  echo " The default model (~1.3GB) will also be"
  echo " downloaded so chat works immediately."
  echo
  echo " Hardware requirements:"
  echo "    Minimum: 8GB RAM"
  echo "    Recommended: 16GB RAM"
  echo
  echo " If you choose not to install Ollama, you can still"
  echo " use a custom LLM endpoint by providing a URL and"
  echo " API key in the Settings page."
  echo
  echo " You can also install Ollama manually from"
  echo " https://ollama.com/download if you prefer."
  echo
  read -p "Do you want to install Ollama now? (y/n): " INSTALL_OLLAMA

  if [ "$INSTALL_OLLAMA" = "y" ] || [ "$INSTALL_OLLAMA" = "Y" ]; then
    echo
    echo "[INFO] Installing Ollama..."
    if curl -fsSL https://ollama.com/install.sh | sh; then
      echo "[INFO] Ollama installed successfully."
      echo "[INFO] Pulling default model llama3.2:1b (~1.3GB). This may take a while..."
      if ollama pull llama3.2:1b; then
        echo "[INFO] Model llama3.2:1b ready."
      else
        echo "[WARN] Could not pull default model. You can pull it manually with: ollama pull llama3.2:1b"
      fi
    else
      echo "[ERROR] Ollama installation failed."
      echo "        You can install it manually from https://ollama.com/download"
      echo
      exit 1
    fi
  else
    echo
    echo "[WARN] Ollama not installed."
    echo "        You can still use the app, but the chat feature will need"
    echo "        a custom LLM endpoint configured in Settings"
    echo "        (e.g., an OpenAI-compatible API URL)."
  fi
fi

# --- Start server ---
echo
echo "[INFO] Starting server on http://localhost:3000"
echo "[INFO] Press Ctrl+C to stop the server."
echo
npm start
