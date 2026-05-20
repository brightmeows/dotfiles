#!/bin/bash
# Merge managed Pi settings (from settings.meow.json) into settings.json
# Pi-managed keys (provider, model, lastChangelogVersion) are preserved.
set -euo pipefail

SETTINGS="${HOME}/.pi/agent/settings.json"
MEOW="${HOME}/.pi/agent/settings.meow.json"

if [ ! -f "$MEOW" ]; then
  echo "Warning: $MEOW not found, skipping merge" >&2
  exit 0
fi

mkdir -p "$(dirname "$SETTINGS")"

# If it's a symlink (from previous chezmoi management), remove it first
# to avoid writing into the dotfiles repo by accident.
if [ -L "$SETTINGS" ]; then
  rm "$SETTINGS"
fi

MANAGED=$(cat "$MEOW")

if [ ! -f "$SETTINGS" ]; then
  echo "$MANAGED" > "$SETTINGS"
else
  # Merge: managed keys overwrite settings.json values.
  # 'packages' array is union-merged (deduped) instead of overwritten,
  # so that pi-install additions and managed defaults coexist.
  jq -s '
    (.[0].packages // []) as $mp |
    (.[1].packages // []) as $sp |
    (.[1] * .[0]) |
    .packages = ($mp + $sp | unique)
  ' "$MEOW" "$SETTINGS" > "${SETTINGS}.tmp" \
    && mv "${SETTINGS}.tmp" "$SETTINGS"
fi
