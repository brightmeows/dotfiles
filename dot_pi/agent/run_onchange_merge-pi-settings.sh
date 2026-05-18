#!/bin/bash
# Merge managed Pi settings into ~/.pi/agent/settings.json
# Pi-managed keys (provider, model, lastChangelogVersion) are preserved.
set -euo pipefail

SETTINGS="${HOME}/.pi/agent/settings.json"
MANAGED=$(cat <<'JSON'
{
  "theme": "dark",
  "quietStartup": true,
  "retry": { "enabled": true, "maxRetries": 3 },
  "skills": ["~/.agents_meow/skills/"],
  "enableSkillCommands": true
}
JSON
)

mkdir -p "$(dirname "$SETTINGS")"

# If it's a symlink (e.g., from previous chezmoi management), remove it first
# to avoid writing into the dotfiles repo by accident.
if [ -L "$SETTINGS" ]; then
  rm "$SETTINGS"
fi

if [ ! -f "$SETTINGS" ]; then
  echo "$MANAGED" > "$SETTINGS"
else
  echo "$MANAGED" | jq -s '.[0] * .[1]' "$SETTINGS" - > "${SETTINGS}.tmp" \
    && mv "${SETTINGS}.tmp" "$SETTINGS"
fi
