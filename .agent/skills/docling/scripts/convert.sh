#!/usr/bin/env bash
# Convert a document to markdown using Docling
# Usage: ./convert.sh <input-path-or-url> [output-dir]
#
# Installs docling if not available, then converts the document.
# Output defaults to /tmp/docling-output/

set -euo pipefail

INPUT="${1:?Usage: convert.sh <input-path-or-url> [output-dir]}"
OUTPUT_DIR="${2:-/tmp/docling-output}"

# Install docling if needed
if ! command -v docling &>/dev/null; then
  echo "Installing docling..."
  pip install --quiet docling
fi

mkdir -p "$OUTPUT_DIR"

echo "Converting: $INPUT"
echo "Output dir: $OUTPUT_DIR"

docling "$INPUT" --output "$OUTPUT_DIR" --to md

echo ""
echo "Done. Output files:"
ls -la "$OUTPUT_DIR"/*.md 2>/dev/null || echo "No markdown files generated"
