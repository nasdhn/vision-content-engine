#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-$HOME/Desktop/vision-content-engine}"

mkdir -p "$TARGET"
cd "$TARGET"

if [ ! -d .git ]; then
  git init
fi

mkdir -p docs/adr

echo "Repository initialized at: $TARGET"
echo "Copy the reference-pack files into this repository, then run:"
echo "  git add ."
echo '  git commit -m "docs: initialize Vision Content Engine specification"'
