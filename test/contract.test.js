const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8')
}

const manifest = JSON.parse(read('manifest.json'))
assert.equal(manifest.schemaVersion, 1)
assert.equal(manifest.id, 'community.pomodoro')
assert.deepEqual(manifest.kinds, ['bar-widget'])
assert.equal(manifest.entryPoints.barWidget, 'PomodoroWidget.qml')
assert.equal(manifest.license, 'MIT')
assert.match(read('LICENSE'), /MIT License/)

const widget = read('PomodoroWidget.qml')

// Bar-widget contract.
assert.match(widget, /^BarWidget \{/m, 'root is the shared BarWidget base')
assert.match(widget, /moduleName: "community\.pomodoro"/)
assert.match(widget, /implicitWidth: button\.implicitWidth/, 'the bar slot sizes from the widget')
assert.match(widget, /bar: root\.bar/, 'the button receives the injected bar')

// Engine contract: state lives in the state file and derives from the wall
// clock, so restarts resume exactly; every mutation goes through the model.
assert.match(widget, /PomodoroModel\.statePath/, 'the state path comes from the model')
assert.match(widget, /PomodoroModel\.parseState/, 'loads validate through the model')
assert.match(widget, /PomodoroModel\.serializeState/, 'writes serialize through the model')
assert.match(widget, /PomodoroModel\.resolveState/, 'stale sessions reconcile through the model')
assert.match(widget, /watchChanges: true/, 'all bar instances render the same session')
assert.match(widget, /onSaved: reload\(\)/, 'the writer cache tracks disk')

// Dormancy: the 1 Hz tick runs only while a session is actively counting.
assert.match(widget, /running: root\.running/, 'idle and paused chips tick nothing')
assert.equal((widget.match(/\bTimer\s*\{/g) || []).length, 2,
  'the countdown tick and the one-shot startup reconcile, nothing else')

// Multi-monitor: side effects are leader-gated so nothing fires per screen.
assert.match(widget, /readonly property bool leader/, 'one instance owns side effects')
assert.match(widget, /if \(!leader \|\| !config\.autoDnd\) return/, 'DND is leader-gated')
assert.match(widget, /if \(!leader \|\| fromPhase === state\.phase\) return/,
  'notifications are leader-gated')
assert.match(widget, /PomodoroModel\.completionNotice/,
  'end-of-phase copy comes from the model')
assert.match(widget, /PomodoroModel\.skipPhase/,
  'skip is a distinct path that does not count unfinished work')
assert.match(widget, /PomodoroModel\.phaseToStart/,
  'idle click starts the pending phase rather than always work')

// DND integration goes through the first-party service, never a subprocess.
assert.match(widget, /serviceFor\("omarchy\.notifications"\)/)
assert.match(widget, /setDoNotDisturb/)
assert.match(widget, /dndWasOn/, 'the pre-session DND state is restored, not blindly cleared')

// The only subprocess is the transition notification, argument-array only.
// Critical + app-name notify-send is how omarchy-shell lets a toast through DND.
assert.equal((widget.match(/\bProcess\s*\{/g) || []).length, 1)
assert.match(widget, /\["notify-send", "-u", "critical", "-a", "notify-send"/)
assert.doesNotMatch(widget, /execDetached|bash -c|sh -c/)

// Scriptable surface.
assert.match(widget, /IpcHandler \{/)
assert.match(widget, /target: "community\.pomodoro"/)

assert.doesNotMatch(widget, /#[0-9a-fA-F]{6}/, 'no hard-coded colors')

console.log('ok - pomodoro contract')
