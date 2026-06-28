#!/bin/bash
# Merge managed Git config (from .gitconfig.meow) into .gitconfig
# Managed keys overwrite local values; local-only keys are preserved.
set -euo pipefail

MEOW="${HOME}/.gitconfig.meow"
TARGET="${HOME}/.gitconfig"

if [ ! -f "$MEOW" ]; then
  echo "Warning: $MEOW not found, skipping merge" >&2
  exit 0
fi

# If it's a symlink (from previous chezmoi management), remove it first
# to avoid writing into the dotfiles repo by accident.
if [ -L "$TARGET" ]; then
  rm "$TARGET"
fi

if [ ! -f "$TARGET" ]; then
  # No existing config — use managed version as-is
  cp "$MEOW" "$TARGET"
  exit 0
fi

# Merge: for each key in the managed file, replace its values in the target.
# Keys not present in managed (local-only additions) are preserved.
git config --file "$MEOW" --list --name-only 2>/dev/null | while IFS= read -r key; do
  [ -z "$key" ] && continue

  # Remove all existing values of this key in target
  git config --file "$TARGET" --unset-all "$key" 2>/dev/null || true

  # Add all values from managed config (--null preserves empty values, e.g. empty helper =)
  git config --null --file "$MEOW" --get-all "$key" 2>/dev/null | \
    while IFS= read -r -d '' value; do
      git config --file "$TARGET" --add "$key" "$value"
    done
done
