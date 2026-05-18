# Merge managed Pi settings into ~/.pi/agent/settings.json
# Pi-managed keys (provider, model, lastChangelogVersion) are preserved.
$ErrorActionPreference = 'Stop'

$SettingsPath = "$HOME\.pi\agent\settings.json"
$Managed = [PSCustomObject]@{
    theme               = 'dark'
    quietStartup        = $true
    retry               = @{ enabled = $true; maxRetries = 3 }
    skills              = @("~/.agents_meow/skills/")
    enableSkillCommands = $true
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

if (Test-Path $SettingsPath) {
    $Existing = Get-Content $SettingsPath -Raw | ConvertFrom-Json
    # Apply managed keys (overwrite)
    foreach ($Prop in $Managed.PSObject.Properties) {
        $Existing.$($Prop.Name) = $Prop.Value
    }
    $Existing | ConvertTo-Json -Depth 10 | Set-Content $SettingsPath -NoNewline
} else {
    $Managed | ConvertTo-Json -Depth 10 | Set-Content $SettingsPath -NoNewline
}
