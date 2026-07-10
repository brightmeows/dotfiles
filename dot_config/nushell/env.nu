# Load environment file with += (append) and <= (prepend) support
# Format: KEY=VALUE | KEY+=value (append with :) | KEY<=value (prepend with :)
def --env load-env-file [path: string] {
    if not ($path | path exists) { return }
    let lines = (open $path
        | lines
        | where {|line|
            let t = ($line | str trim)
            ($t | is-not-empty) and not ($t | str starts-with "#")
        })

    for line in $lines {
        let eq = ($line | str index-of "=")
        if $eq < 0 { continue }
        let raw_key = ($line | str substring 0..<$eq | str trim)
        let raw_val = ($line | str substring ($eq + 1).. | str trim)
        let value = if ($raw_val | str starts-with "~") { $raw_val | path expand } else { $raw_val }

        if ($raw_key | str ends-with "+") {
            let key = ($raw_key | str substring 0..<-1)
            let cur = ($env | get -i $key)
            let new = if ($cur | describe | str starts-with "list") {
                $cur | append $value
            } else if ($cur | is-empty) {
                $value
            } else {
                $"($cur):($value)"
            }
            load-env ({} | insert $key $new)
        } else if ($raw_key | str ends-with "<") {
            let key = ($raw_key | str substring 0..<-1)
            let cur = ($env | get -i $key)
            let new = if ($cur | describe | str starts-with "list") {
                $cur | prepend $value
            } else if ($cur | is-empty) {
                $value
            } else {
                $"($value):($cur)"
            }
            load-env ({} | insert $key $new)
        } else {
            load-env ({} | insert $raw_key $value)
        }
    }
}

load-env-file ($env.HOME | path join ".env_common")
load-env-file ($env.HOME | path join ".env_self")

# Convert PATH to list (env files loaded it as colon-separated string)
$env.PATH = ($env.PATH | split row (char env_sep))

# pnpm
$env.PNPM_HOME = "/var/home/brightmeows/.local/share/pnpm"
$env.PATH = ($env.PATH | prepend $env.PNPM_HOME)

# GitHub token
try {
    let gh_token = (do { gh auth token } | str trim)
    if not ($gh_token | is-empty) {
        $env.GITHUB_TOKEN = $gh_token
    }
}

# Editor
if (which nixvim | is-not-empty) {
    $env.EDITOR = "nixvim"
}

# Alias vi/vim → nvim
alias vi = nvim
alias vim = nvim
