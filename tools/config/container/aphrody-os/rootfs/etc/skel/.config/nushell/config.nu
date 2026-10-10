# Nushell defaults for the Aphrody image.
$env.config.show_banner = false
$env.config.edit_mode = "emacs"

# Nushell's `ls` returns structured tables; eza and uutils stay one caret away.
alias ll = eza -l --git --icons=never
alias la = eza -la --git --icons=never
alias lt = eza --tree --level=2
