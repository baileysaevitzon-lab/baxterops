#!/usr/bin/env bash
# Upload the 41 pending tour photos (Highland + 1600 Vine intake) to Supabase Storage.
#
# Storage writes are now authenticated-only (Sprint 8 security fix), so this script
# requires either:
#   - SUPABASE_SERVICE_ROLE_KEY (bypasses RLS — keep OFF the frontend bundle)
#   - SUPABASE_ACCESS_TOKEN (an authenticated user's JWT, e.g. from /login)
#
# Reads NEXT_PUBLIC_SUPABASE_URL from .env.local.
#
# Path convention:
#   pending-assignment/<photoOrder>-<filenameStemLower>.jpg
#
# After upload, the script DOES NOT pre-assign photos to a competitor. Bailey
# triages them in /photos-amenities (or the dashboard) by clicking
# "Assign to Highland" or "Assign to 1600 Vine" per photo.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"
SRC="$ROOT/public/tour-photos/pending-assignment"
BUCKET="baxter-ops-photos"
PREFIX="pending-assignment"

# Load env
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2; exit 1
fi
# shellcheck disable=SC1090
export $(grep -E "^NEXT_PUBLIC_SUPABASE_URL=" "$ENV_FILE" | xargs)

if [[ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ]]; then
  echo "NEXT_PUBLIC_SUPABASE_URL not set in $ENV_FILE." >&2; exit 1
fi

# Pick auth: service-role (preferred for one-off) or user access token
AUTH_KEY="${SUPABASE_SERVICE_ROLE_KEY:-${SUPABASE_ACCESS_TOKEN:-}}"
if [[ -z "$AUTH_KEY" ]]; then
  cat >&2 <<EOF
Missing auth credentials. Provide ONE of:
  SUPABASE_SERVICE_ROLE_KEY=...     # from Supabase dashboard → API settings (keep OFF git)
  SUPABASE_ACCESS_TOKEN=...         # JWT from a signed-in user (e.g. dev /login)

Example:
  SUPABASE_SERVICE_ROLE_KEY=eyJ... bash scripts/upload-pending-photos.sh
EOF
  exit 1
fi

if [[ ! -d "$SRC" ]]; then
  echo "Source directory not found: $SRC" >&2; exit 1
fi

ok=0; fail=0; order=0
shopt -s nullglob
for src_file in "$SRC"/*.jpg; do
  order=$((order + 1))
  stem="$(basename "$src_file" .jpg)"
  stem_lower="$(printf '%s' "$stem" | tr '[:upper:]' '[:lower:]')"
  remote_key="${PREFIX}/$(printf '%02d' "$order")-${stem_lower}.jpg"

  http_code=$(curl -s -o /tmp/upload.body -w "%{http_code}" \
    -X POST "$NEXT_PUBLIC_SUPABASE_URL/storage/v1/object/$BUCKET/$remote_key" \
    -H "apikey: $AUTH_KEY" \
    -H "Authorization: Bearer $AUTH_KEY" \
    -H "x-upsert: true" \
    -H "Content-Type: image/jpeg" \
    --data-binary "@$src_file" || true)

  if [[ "$http_code" =~ ^2 ]]; then
    ok=$((ok + 1))
    printf "ok (%s): %s\n" "$http_code" "$remote_key"
  else
    fail=$((fail + 1))
    body="$(cat /tmp/upload.body 2>/dev/null || true)"
    echo "FAIL ($http_code): $remote_key   body=$body"
  fi
done

echo
echo "Done. uploaded=$ok failed=$fail"
echo "Next: open BaxterOps → /photos-amenities → 'Pending assignment' tab to triage each photo."
