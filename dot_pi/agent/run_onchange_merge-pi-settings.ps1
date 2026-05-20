# Merge managed Pi settings (from settings.meow.json) into settings.json
# Pi-managed keys (provider, model, lastChangelogVersion) are preserved.
$ErrorActionPreference = 'Stop'

$SettingsPath = "$HOME\.pi\agent\settings.json"
$MeowPath = "$HOME\.pi\agent\settings.meow.json"

if (-not (Test-Path $MeowPath)) {
    Write-Warning "$MeowPath not found, skipping merge"
    exit 0
}

$Dir = Split-Path $SettingsPath -Parent
if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Force $Dir | Out-Null }

# If it's a symlink/junction (from previous chezmoi management), remove it first
if (Test-Path $SettingsPath) {
    $Item = Get-Item $SettingsPath -Force
    if ($Item.LinkType) {
        Remove-Item $SettingsPath -Force
    }
}

$Managed = Get-Content $MeowPath -Raw | ConvertFrom-Json

if (Test-Path $SettingsPath) {
    $Existing = Get-Content $SettingsPath -Raw | ConvertFrom-Json
    foreach ($Prop in $Managed.PSObject.Properties) {
        # Merge packages array with dedup instead of overwrite
        if ($Prop.Name -eq 'packages' -and $Existing.packages) {
            $Merged = @($Prop.Value) + @($Existing.packages) | Select-Object -Unique
            $Existing.packages = @($Merged)
        } else {
            $Existing.($Prop.Name) = $Prop.Value
        }
    }
    $Existing | ConvertTo-Json -Depth 10 | Set-Content $SettingsPath -NoNewline
} else {
    $Managed | ConvertTo-Json -Depth 10 | Set-Content $SettingsPath -NoNewline
}
