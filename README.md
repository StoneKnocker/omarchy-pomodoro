# Pomodoro

A focus timer in the [Omarchy](https://omarchy.org) v4 bar: work/break
cycles (25 minutes focus, 5 minutes rest), automatic Do Not Disturb
during focus, and a session counter for the day.

When a work or break period ends, the timer stops and a desktop notification
prompts you to start the next round — clicking the notification or the bar
begins the next phase (e.g. clicking the break-over toast starts a 25-minute
focus session, and clicking the focus-complete toast starts a 5-minute break).
It never auto-starts. Only a work period that actually runs to 0 counts as done;
skip, reset, and other interrupts leave today's count unchanged.

The whole session lives in a state file keyed to the wall clock, so a shell
restart resumes the countdown exactly, and every monitor's bar shows the
same session (side effects run once, on one instance).

## Use

| Action | Effect |
| --- | --- |
| Left click | Start the pending phase / pause / resume |
| Right click | Skip to the next phase (does not count unfinished work) |
| Middle click | Reset to idle (keeps today's completed count) |
| Click notification | Start the next phase (focus or break) |

The chip shows the remaining time while a session runs, dims while paused,
and takes the bar's active color during focus. DND turns on for focus
phases and restores your pre-session setting afterwards, so the end-of-phase
notification can land.

From scripts or keybindings:

```sh
omarchy-shell community.pomodoro toggle | start [phase] | skip | reset | status
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
| `breakMinutes` | `5` | Break length |
| `autoDnd` | `true` | Silence notifications during focus |

## Tests

```sh
OMARCHY_PATH=/path/to/omarchy ./test/all
```

## License

[MIT](LICENSE)
