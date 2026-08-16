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

// Completing work increments cycle and today, then starts the break.
s = model.startPhase(model.idleState(), 'work', T0, config)
s = model.completePhase(s, T0 + 25 * 60000, config)
assert.equal(s.phase, 'break')
assert.equal(s.cycleCount, 1)
assert.equal(s.todayCount, 1)

// Every fourth work earns the long break.
let s4 = model.idleState()
for (let i = 0; i < 4; i++) {
  s4 = model.startPhase(s4, 'work', T0, config)
  s4 = model.completePhase(s4, T0 + 1000, config)
  if (i < 3) {
    assert.equal(s4.phase, 'break', `cycle ${i + 1} takes a short break`)
    s4 = model.completePhase(s4, T0 + 2000, config)
    assert.equal(s4.phase, 'work')
  }
}
assert.equal(s4.phase, 'longBreak')
assert.equal(s4.todayCount, 4)

// Breaks do not increment counters.
const afterBreak = model.completePhase(s4, T0 + 3000, config)
assert.equal(afterBreak.phase, 'work')
assert.equal(afterBreak.todayCount, 4)

// ---- restart reconciliation -------------------------------------------------

// A work session that fully elapsed while the shell was down completes into
// its break, and the counters advance exactly once.
s = model.startPhase(model.idleState(), 'work', T0, config)
let resolved = model.resolveState(s, T0 + 26 * 60000, config)
assert.equal(resolved.phase, 'break')
assert.equal(resolved.todayCount, 1)
assert.equal(model.remainingMs(resolved, T0 + 26 * 60000), 4 * 60000,
  'the break started when the work actually ended')

// Long absence chains through several phases without runaway.
resolved = model.resolveState(s, T0 + 3 * 60 * 60000, config)
assert.notEqual(resolved.phase, 'idle')
assert.ok(resolved.cycleCount >= 3, 'multiple cycles completed while away')

// A paused session never advances.
s = model.pause(model.startPhase(model.idleState(), 'work', T0, config), T0 + 1000)
resolved = model.resolveState(s, T0 + 9 * 60 * 60000, config)
assert.equal(model.isPaused(resolved), true)

// The daily counter resets on a new day.
s = model.startPhase(model.idleState(), 'work', T0, config)
s = model.completePhase(s, T0 + 1000, config)
assert.equal(s.todayCount, 1)
const nextDay = model.withTodayTest ? null : model.resolveState(
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

console.log('ok - pomodoro model')
