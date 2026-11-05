#!/bin/bash
# Restore the managed fcitx5 global config after an Omarchy update.
#
# Omarchy's input-method migration can remove Control+space from
# ~/.config/fcitx5/config. Apply only that managed file, then reload fcitx5;
# never run a full chezmoi apply from an update hook.
set -euo pipefail

config="$HOME/.config/fcitx5/config"
command -v chezmoi >/dev/null 2>&1 || exit 0

# Nothing to do when the deployed file already matches the source.
if [[ -z $(chezmoi diff --exclude=scripts "$config" 2>/dev/null) ]]; then
  exit 0
fi

chezmoi apply --force --exclude=scripts "$config"

if fcitx5-remote --check >/dev/null 2>&1; then
  fcitx5-remote -r >/dev/null 2>&1 || true
fi
