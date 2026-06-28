# Load custom environment variables from ~/.env_self
let env_file = $"($env.HOME)/.env_self"
if ($env_file | path exists) {
    open $env_file
    | lines
    | where {|line| $line !~ '^#' and ($line | str trim) != '' }
    | parse '{key}={value}'
    | transpose -r -d
    | load-env
}

# Allow unfree Nix packages
$env.NIXPKGS_ALLOW_UNFREE = "1"

# PATH setup
$env.PATH = ($env.PATH | split row (char env_sep))
$env.PATH = ($env.PATH | append ("~" | path expand | path join "bin"))
$env.PATH = ($env.PATH | append ("~" | path expand | path join ".local/bin"))
$env.PATH = ($env.PATH | append ("~" | path expand | path join "go/bin"))
$env.PATH = ($env.PATH | append ("~" | path expand | path join ".cargo/bin"))
$env.PATH = ($env.PATH | append ("~" | path expand | path join ".opencode/bin"))
$env.PATH = ($env.PATH | append ("~" | path expand | path join ".bun/bin"))

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
