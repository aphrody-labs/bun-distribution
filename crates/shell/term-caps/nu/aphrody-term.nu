# SPDX-License-Identifier: Apache-2.0
# Terminal integration for `aphrody shell start`, embedded in aphrody-term-caps.
# `aphrody shell start` sets APHRODY_EXE and APHRODY_TERM_CAPS (comma list of
# capability ids from `aphrody shell caps`) before loading this module.

def aphrody-exe [] { $env.APHRODY_EXE? | default "aphrody" }

def has-cap [cap: string] {
  $cap in ($env.APHRODY_TERM_CAPS? | default "" | split row ",")
}

export-env {
  let caps = $env.APHRODY_TERM_CAPS? | default "" | split row ","
  $env.config.shell_integration = {
    osc2: true
    osc7: ("cwd_osc7" in $caps)
    osc8: ("hyperlinks" in $caps)
    osc9_9: ("cwd_osc9_9" in $caps)
    osc133: ("prompt_marks" in $caps)
    osc633: ("vscode_marks" in $caps)
    reset_application_mode: true
  }
  if "progress" in $caps {
    # OSC 9;4 busy indicator for commands still running after one second.
    let start = {||
      $env.APHRODY_PROGRESS_JOB = (job spawn { sleep 1sec; print -n "\e]9;4;3;0\e\\" })
    }
    let stop = {||
      if ($env.APHRODY_PROGRESS_JOB? | default null) != null {
        try { job kill $env.APHRODY_PROGRESS_JOB }
        print -n "\e]9;4;0;0\e\\"
        $env.APHRODY_PROGRESS_JOB = null
      }
    }
    $env.config.hooks.pre_execution = ($env.config.hooks.pre_execution? | default [] | append $start)
    $env.config.hooks.pre_prompt = ($env.config.hooks.pre_prompt? | default [] | append $stop)
  }
}

# Shows an image inline with the best protocol of this terminal
# (kitty, then Sixel, then iTerm2).
export def img [
  file: path            # image file (PNG, JPEG, GIF, WebP, ...)
  --width (-w): int     # width in cells
  --protocol (-p): string  # force kitty | sixel | iterm2
] {
  mut args = [shell img ($file | path expand)]
  if $width != null { $args = ($args | append [--width ($width | into string)]) }
  if $protocol != null { $args = ($args | append [--protocol $protocol]) }
  ^(aphrody-exe) ...$args
}

# Runs a command and turns the file paths of its stderr into OSC 8 links.
export def --wrapped lk [...command: string] {
  if (has-cap "hyperlinks") {
    run-external ...$command e>| ^(aphrody-exe) shell links
  } else {
    run-external ...$command
  }
}

# Capabilities of the current terminal (environment, then live probe).
export def caps [--no-probe] {
  if $no_probe {
    ^(aphrody-exe) shell caps --json | from json
  } else {
    ^(aphrody-exe) shell caps --json --probe | from json
  }
}
