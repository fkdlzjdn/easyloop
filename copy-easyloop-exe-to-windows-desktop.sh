#!/usr/bin/env bash
set -euo pipefail

SRC="/home/syscon/repo/easyloop/dist/EasyLoop.exe"
DST="/mnt/c/Users/PCuser/Desktop/EasyLoop-v1.3.0.exe"

if [[ ! -f "$SRC" ]]; then
  echo "Source exe not found: $SRC" >&2
  exit 1
fi

cp "$SRC" "$DST"
echo "Copied to: $DST"
