# The default config record. This is where much of your global configuration is setup.
$env.config.show_banner = false # true or false to enable or disable the welcome banner at startup
$env.config.hooks = ($env.config.hooks | merge {
    env_change: {
        PWD: [
    # Direnv integration
    { ||
        if (which direnv | is-empty) {
            return
        }

        direnv export json | from json | default {} | load-env
        # Direnv outputs $PATH as a string, but nushell silently breaks if isn't a list-like table.
        # The following behemoth of Nu code turns this into nu's format while following the standards of how to handle quotes, use it if you need quote handling instead of the line below it:
        # $env.PATH = $env.PATH | parse --regex ('' + `((?:(?:"(?:(?:\\[\\"])|.)*?")|(?:'.*?')|[^` + (char env_sep) + `]*)*)`) | each {|x| $x.capture0 | parse --regex `(?:"((?:(?:\\"|.))*?)")|(?:'(.*?)')|([^'"]*)` | each {|y| if ($y.capture0 != "") { $y.capture0 | str replace -ar `\\([\\"])` `$1` } else if ($y.capture1 != "") { $y.capture1 } else $y.capture2 } | str join }
        $env.PATH = $env.PATH | split row (char env_sep)
    }
]}})

if (which starship | is-not-empty) {
    let starship_file = ($nu.data-dir | path join "vendor/autoload/starship.nu")
    if not ($starship_file | path exists) {
        mkdir ($nu.data-dir | path join "vendor/autoload")
        starship init nu | save -f $starship_file
    }
}

# Aliases（与 dot_bashrc 保持对齐）
alias ze = zellij
alias oc = opencode
alias nv = nvim
alias vi = nvim
alias vim = nvim
alias lg = lazygit
alias k = kubectl
alias urldecode = url decode
alias urlencode = url encode

# GitHub CLI token（与 dot_bashrc 语义一致）
if (which gh | is-not-empty) {
    try { $env.GITHUB_TOKEN = (gh auth token) }
}
