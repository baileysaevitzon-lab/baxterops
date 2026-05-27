#!/usr/bin/env bash
# Convert Zen Hollywood field-tour .heic files to .jpg.
# Uses macOS built-in `sips`. No external deps.
#
# Source:   /Users/shane/Desktop/The Zen/
# Output:   public/zen-tour/converted/

set -euo pipefail

SRC="${1:-/Users/shane/Desktop/The Zen}"
DST="${2:-public/zen-tour/converted}"

if ! command -v sips >/dev/null; then
  echo "sips not found (macOS-only). Use ImageMagick: brew install imagemagick && magick convert ..." >&2
  exit 1
fi

mkdir -p "$DST"

count=0
shopt -s nullglob
for f in "$SRC"/*.heic "$SRC"/*.HEIC; do
  base="$(basename "$f")"
  stem="${base%.*}"
  out="$DST/${stem}.jpg"
  if [[ -f "$out" ]]; then
    echo "skip (exists): $out"
  else
    sips -s format jpeg -s formatOptions 85 "$f" --out "$out" >/dev/null
    echo "ok: $out"
  fi
  count=$((count + 1))
done

echo "Converted/verified $count files into $DST"
