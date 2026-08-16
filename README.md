# Pomodoro

A focus timer in the [Omarchy](https://omarchy.org) v4 bar: work/break
cycles with a long break every fourth round, automatic Do Not Disturb
during focus, and a session counter for the day.

The whole session lives in a state file keyed to the wall clock, so a shell
restart resumes the countdown exactly, and every monitor's bar shows the
same session (side effects run once, on one instance).

## Use

| Action | Effect |
| --- | --- |
| Left click | Start a focus session / pause / resume |
| Right click | Skip to the next phase |
| Middle click | Reset to idle (keeps today's count) |

The chip shows the remaining time while a session runs, dims while paused,
and takes the bar's active color during focus. DND turns on for focus
phases and restores your pre-session setting afterwards.

From scripts or keybindings:

```sh
omarchy-shell community.pomodoro toggle | skip | reset | status
```

## Install

```sh
omarchy plugin add https://github.com/devmobasa/omarchy-pomodoro --enable
```

## Settings

Inline on the bar layout entry in `~/.config/omarchy/shell.json`
(`omarchy bar set community.pomodoro <key> <value>`):

| Key | Default | Meaning |
| --- | --- | --- |
| `workMinutes` | `25` | Focus phase length |
| `breakMinutes` | `5` | Short break length |
| `longBreakMinutes` | `15` | Long break length |
| `cyclesPerLong` | `4` | Focus phases per long break |
| `autoDnd` | `true` | Silence notifications during focus |

## Tests

```sh
OMARCHY_PATH=/path/to/omarchy ./test/all
```

## License

[MIT](LICENSE)
