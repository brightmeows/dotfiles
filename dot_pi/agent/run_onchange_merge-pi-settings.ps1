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

    # Convert PSCustomObject to ordered hashtable for flexible merge
    $Merged = [ordered]@{}
    foreach ($Prop in $Existing.PSObject.Properties) {
        $Merged[$Prop.Name] = $Prop.Value
    }

    foreach ($Prop in $Managed.PSObject.Properties) {
        if ($Prop.Name -eq 'packages' -and $null -ne $Merged['packages']) {
            # Merge packages array with dedup instead of overwrite
            $Merged.packages = @($Prop.Value) + @($Merged.packages) | Select-Object -Unique
        } else {
            $Merged[$Prop.Name] = $Prop.Value
        }
    }

    [PSCustomObject]$Merged | ConvertTo-Json -Depth 10 | Set-Content $SettingsPath -NoNewline
} else {
    $Managed | ConvertTo-Json -Depth 10 | Set-Content $SettingsPath -NoNewline
}
