#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Please install Node.js 18+ first: https://nodejs.org/"
  read -r -p "Press Enter to exit..."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not installed. Please reinstall Node.js with npm."
  read -r -p "Press Enter to exit..."
  exit 1
fi

if [ ! -d "node_modules/miniprogram-automator" ]; then
  echo "Installing dependencies..."
  npm install || {
    echo "Dependency installation failed. Check your network or npm registry."
    read -r -p "Press Enter to exit..."
    exit 1
  }
fi

npm run test
echo ""
echo "Report: $DIR/reports/index.html"
read -r -p "Press Enter to exit..."
