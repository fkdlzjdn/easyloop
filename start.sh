#!/bin/bash
cd "$(dirname "$0")"

# Install dependencies if node_modules missing
if [ ! -d "node_modules" ]; then
  echo "node_modules not found. Installing dependencies..."
  npm install
fi

echo "Starting EasyLoop Server..."
node server.js
