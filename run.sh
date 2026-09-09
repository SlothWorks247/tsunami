#!/bin/bash
# Notes to Sizing/POV - one-step start script for Mac/Linux
set -e
cd "$(dirname "$0")"
echo "Installing dependencies..."
npm install
echo "Starting server..."
npm start
