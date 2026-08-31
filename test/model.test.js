const assert = require('node:assert/strict')
const model = require('../model/PomodoroModel.js')

const config = model.readConfig({})
const T0 = Date.parse('2026-08-02T10:00:00')

// ---- config validation ------------------------------------------------------

assert.deepEqual(config, {
  workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, cyclesPerLong: 4, autoDnd: true
})
assert.equal(model.readConfig({ workMinutes: 50 }).workMinutes, 50)
assert.equal(model.readConfig({ workMinutes: 0 }).workMinutes, 25, 'zero is invalid')
assert.equal(model.readConfig({ workMinutes: 'x' }).workMinutes, 25)
assert.equal(model.readConfig({ cyclesPerLong: 99 }).cyclesPerLong, 4, 'out of range')
assert.equal(model.readConfig({ autoDnd: false }).autoDnd, false)

// ---- session flow -----------------------------------------------------------

let s = model.startPhase(model.idleState(), 'work', T0, config)
assert.equal(s.phase, 'work')
assert.equal(model.remainingMs(s, T0), 25 * 60000)
assert.equal(model.remainingMs(s, T0 + 60000), 24 * 60000)
assert.equal(model.formatRemaining(model.remainingMs(s, T0 + 60000)), '24:00')
assert.equal(model.formatRemaining(model.remainingMs(s, T0 + 61000)), '23:59')
assert.equal(model.formatRemaining(model.remainingMs(s, T0)), '25:00')

// Pause freezes the remainder; resume restores it against the new clock.
s = model.pause(s, T0 + 5 * 60000)
assert.equal(model.isPaused(s), true)
assert.equal(model.remainingMs(s, T0 + 60 * 60000), 20 * 60000, 'paused time does not drain')
s = model.resume(s, T0 + 60 * 60000)
assert.equal(model.isPaused(s), false)
assert.equal(model.remainingMs(s, T0 + 60 * 60000), 20 * 60000)

// Completing work increments cycle and today, then idles with a pending break.
s = model.startPhase(model.idleState(), 'work', T0, config)
s = model.completePhase(s, T0 + 25 * 60000, config)
assert.equal(s.phase, 'idle', 'the next phase does not auto-start')
assert.equal(s.pendingPhase, 'break')
assert.equal(s.cycleCount, 1)
assert.equal(s.todayCount, 1)
assert.equal(s.endsAtMs, 0)
assert.equal(model.phaseToStart(s), 'break')
assert.deepEqual(model.completionNotice('work', s), {
  title: 'Focus complete',
  body: '1 done today. Click the bar to start your break.'
})

// An unfinished work period is not counted as done.
const unfinished = model.startPhase(model.idleState(), 'work', T0, config)
const interrupted = model.completePhase(unfinished, T0 + 5 * 60000, config)
assert.equal(interrupted.todayCount, 0, 'cutting a work period short does not count')
assert.equal(interrupted.cycleCount, 0)
assert.equal(interrupted.phase, 'idle')
assert.equal(interrupted.pendingPhase, 'break')

// Skip jumps to the next phase immediately and never counts unfinished work.
let skipped = model.startPhase(model.idleState(), 'work', T0, config)
skipped = model.skipPhase(skipped, T0 + 5 * 60000, config)
assert.equal(skipped.phase, 'break')
assert.equal(skipped.todayCount, 0)
assert.equal(skipped.cycleCount, 0)
skipped = model.skipPhase(skipped, T0 + 6 * 60000, config)
assert.equal(skipped.phase, 'work')
assert.equal(skipped.todayCount, 0)

// Every fourth finished work earns a pending long break.
let s4 = model.idleState()
for (let i = 0; i < 4; i++) {
  s4 = model.startPhase(s4, model.phaseToStart(s4), T0, config)
  assert.equal(s4.phase, 'work')
  s4 = model.completePhase(s4, T0 + 25 * 60000, config)
  if (i < 3) {
    assert.equal(s4.phase, 'idle')
    assert.equal(s4.pendingPhase, 'break', `cycle ${i + 1} takes a short break`)
    s4 = model.startPhase(s4, s4.pendingPhase, T0, config)
    assert.equal(s4.phase, 'break')
    s4 = model.completePhase(s4, T0 + 5 * 60000, config)
    assert.equal(s4.phase, 'idle')
    assert.equal(s4.pendingPhase, 'work')
  }
}
assert.equal(s4.phase, 'idle')
assert.equal(s4.pendingPhase, 'longBreak')
assert.equal(s4.todayCount, 4)
assert.deepEqual(model.completionNotice('work', s4), {
  title: 'Focus complete',
  body: '4 done today. Click the bar to start your long break.'
})

// Breaks do not increment counters; completing one idles with pending work.
s4 = model.startPhase(s4, s4.pendingPhase, T0, config)
assert.equal(s4.phase, 'longBreak')
const afterBreak = model.completePhase(s4, T0 + 15 * 60000, config)
assert.equal(afterBreak.phase, 'idle')
assert.equal(afterBreak.pendingPhase, 'work')
assert.equal(afterBreak.todayCount, 4)
assert.equal(model.completionNotice('longBreak', afterBreak).title, 'Long break over')

// ---- restart reconciliation -------------------------------------------------

// A work session that fully elapsed while the shell was down counts once
// and stops at idle — it does not auto-start the break.
s = model.startPhase(model.idleState(), 'work', T0, config)
let resolved = model.resolveState(s, T0 + 26 * 60000, config)
assert.equal(resolved.phase, 'idle')
assert.equal(resolved.pendingPhase, 'break')
assert.equal(resolved.todayCount, 1)
assert.equal(model.remainingMs(resolved, T0 + 26 * 60000), 0)

// Long absence still completes only the phase that was actually running.
resolved = model.resolveState(s, T0 + 3 * 60 * 60000, config)
assert.equal(resolved.phase, 'idle')
assert.equal(resolved.todayCount, 1)
assert.equal(resolved.cycleCount, 1, 'later cycles are not invented while away')

// A paused session never advances.
s = model.pause(model.startPhase(model.idleState(), 'work', T0, config), T0 + 1000)
resolved = model.resolveState(s, T0 + 9 * 60 * 60000, config)
assert.equal(model.isPaused(resolved), true)
assert.equal(resolved.todayCount, 0, 'a paused interrupt is not done')

// The daily counter resets on a new day.
s = model.startPhase(model.idleState(), 'work', T0, config)
s = model.completePhase(s, T0 + 25 * 60000, config)
assert.equal(s.todayCount, 1)
const nextDay = model.resolveState(
  model.startPhase(s, 'work', T0 + 24 * 60 * 60000, config),
  T0 + 24 * 60 * 60000 + 1, config)
assert.equal(nextDay.todayCount, 0, 'a new day starts the counter fresh')

// ---- persistence ------------------------------------------------------------

const roundTrip = model.parseState(model.serializeState(s4))
assert.deepEqual(roundTrip, s4)
for (const bad of [null, '', 'not json', '[]', '{"phase":"nap"}']) {
  assert.equal(model.parseState(bad).phase, 'idle', `${JSON.stringify(bad)} is a fresh idle`)
}
assert.equal(model.parseState('{"phase":"work","endsAtMs":-5}').endsAtMs, 0,
  'negative numbers are rejected')

assert.equal(model.statePath(null, '/home/u'), '/home/u/.local/state/omarchy/pomodoro.json')
assert.equal(model.statePath('/custom', '/home/u'), '/custom/omarchy/pomodoro.json')

// ---- display helpers --------------------------------------------------------

assert.equal(model.formatRemaining(0), '0:00')
assert.equal(model.formatRemaining(61000), '1:01')
assert.ok(model.glyphFor('work').length > 0)
assert.equal(model.labelFor('longBreak'), 'Long break')
assert.equal(model.startLabel('break'), 'a break')
assert.equal(model.parseState('{"phase":"idle","pendingPhase":"longBreak"}').pendingPhase, 'longBreak')
assert.equal(model.parseState('{"phase":"idle","pendingPhase":"nap"}').pendingPhase, 'work')

console.log('ok - pomodoro model')
