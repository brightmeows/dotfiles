# Merge managed Git config (from .gitconfig.meow) into .gitconfig
# Managed keys overwrite local values; local-only keys are preserved.
$ErrorActionPreference = 'Stop'

$Meow = "$HOME\.gitconfig.meow"
$Target = "$HOME\.gitconfig"

if (-not (Test-Path $Meow)) {
    Write-Warning "$Meow not found, skipping merge"
    exit 0
}

# If it's a symlink/junction (from previous chezmoi management), remove it first
if (Test-Path $Target) {
    $Item = Get-Item $Target -Force
    if ($Item.LinkType) {
        Remove-Item $Target -Force
    }
}

if (-not (Test-Path $Target)) {
    # No existing config — use managed version as-is
    Copy-Item $Meow $Target
    exit 0
}

# Merge: for each key in the managed file, replace its values in the target.
# Keys not present in managed (local-only additions) are preserved.
$keys = @(git config --file "$Meow" --list --name-only 2>$null | Where-Object { $_ })

foreach ($key in $keys) {
    # Remove all existing values of this key in target
    git config --file "$Target" --unset-all "$key" 2>$null

    # Get all values from managed config (--null preserves empty values, e.g. empty helper =)
    $rawValues = git config --null --file "$Meow" --get-all "$key" 2>$null
    if ($rawValues) {
        $values = $rawValues.Split("`0")
        # Remove trailing empty element from final NUL
        if ($values[-1] -eq '') { $values = $values[0..($values.Length - 2)] }
        foreach ($value in $values) {
            git config --file "$Target" --add "$key" "$value"
        }
    }
}
