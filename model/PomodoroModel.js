// Pomodoro engine model. Loaded by both the QML widget and the Node test
// harness, so it must stay dependency-free.
//
// The whole session lives in a small state object persisted to a state file:
//   { phase, endsAtMs, pausedRemainingMs, cycleCount, todayCount, todayDate,
//     dndWasOn }
// Remaining time derives from endsAtMs against the wall clock, so a shell
// restart mid-session resumes exactly; a session that fully elapsed while
// the shell was down still counts.

var PHASES = ["idle", "work", "break", "longBreak"]

var DEFAULTS = {
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  cyclesPerLong: 4,
  autoDnd: true
}

function idleState() {
  return {
    phase: "idle",
    endsAtMs: 0,
    pausedRemainingMs: 0,
    cycleCount: 0,
    todayCount: 0,
    todayDate: "",
    dndWasOn: false
  }
}

// Read widget settings with validation; invalid values fall back.
function readConfig(settings) {
  var s = settings || {}
  function minutes(value, fallback) {
    var n = Number(value)
    return isFinite(n) && n >= 1 && n <= 240 ? Math.floor(n) : fallback
  }
  var cycles = Number(s.cyclesPerLong)
  return {
    workMinutes: minutes(s.workMinutes, DEFAULTS.workMinutes),
    breakMinutes: minutes(s.breakMinutes, DEFAULTS.breakMinutes),
    longBreakMinutes: minutes(s.longBreakMinutes, DEFAULTS.longBreakMinutes),
    cyclesPerLong: isFinite(cycles) && cycles >= 1 && cycles <= 12 ? Math.floor(cycles) : DEFAULTS.cyclesPerLong,
    autoDnd: s.autoDnd === false ? false : DEFAULTS.autoDnd
  }
}

function phaseDurationMs(phase, config) {
  if (phase === "work") return config.workMinutes * 60000
  if (phase === "break") return config.breakMinutes * 60000
  if (phase === "longBreak") return config.longBreakMinutes * 60000
  return 0
}

// The phase that follows a completed one. Completing work increments the
// cycle; every cyclesPerLong-th work earns the long break.
function nextPhase(completedPhase, cycleCountAfter, config) {
  if (completedPhase === "work")
    return cycleCountAfter % config.cyclesPerLong === 0 ? "longBreak" : "break"
  return "work"
}

function dayKey(nowMs) {
  var d = new Date(Number(nowMs))
  var pad = function (n) { return n < 10 ? "0" + n : String(n) }
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
}

// Roll the daily counter when the date changes; harmless on same-day calls.
function withToday(state, nowMs) {
  var key = dayKey(nowMs)
  if (state.todayDate === key) return state
  var next = cloneState(state)
  next.todayDate = key
  next.todayCount = 0
  return next
}

function cloneState(state) {
  return {
    phase: state.phase,
    endsAtMs: state.endsAtMs,
    pausedRemainingMs: state.pausedRemainingMs,
    cycleCount: state.cycleCount,
    todayCount: state.todayCount,
    todayDate: state.todayDate,
    dndWasOn: state.dndWasOn === true
  }
}

// Start a phase now.
function startPhase(state, phase, nowMs, config) {
  var next = withToday(state, nowMs)
  next.phase = phase
  next.endsAtMs = Number(nowMs) + phaseDurationMs(phase, config)
  next.pausedRemainingMs = 0
  return next
}

function pause(state, nowMs) {
  if (state.phase === "idle" || state.pausedRemainingMs > 0) return state
  var next = cloneState(state)
  next.pausedRemainingMs = Math.max(1, state.endsAtMs - Number(nowMs))
  next.endsAtMs = 0
  return next
}

function resume(state, nowMs) {
  if (state.phase === "idle" || state.pausedRemainingMs <= 0) return state
  var next = cloneState(state)
  next.endsAtMs = Number(nowMs) + state.pausedRemainingMs
  next.pausedRemainingMs = 0
  return next
}

function isPaused(state) {
  return state.phase !== "idle" && state.pausedRemainingMs > 0
}

function remainingMs(state, nowMs) {
  if (state.phase === "idle") return 0
  if (isPaused(state)) return state.pausedRemainingMs
  return Math.max(0, state.endsAtMs - Number(nowMs))
}

// Advance past a completed phase. Returns the new state; the caller reads
// state.phase to decide side effects (DND, notification).
function completePhase(state, nowMs, config) {
  var next = withToday(state, nowMs)
  if (next.phase === "idle") return next
  if (next.phase === "work") {
    next.cycleCount = next.cycleCount + 1
    next.todayCount = next.todayCount + 1
  }
  var following = nextPhase(next.phase, next.cycleCount, config)
  return startPhase(next, following, nowMs, config)
}

// Reconcile persisted state against the wall clock after a load: a running
// phase whose end passed while we were away completes (possibly several
// times), so the chip never resurrects a stale countdown.
function resolveState(state, nowMs, config) {
  var next = withToday(state, nowMs)
  var guard = 0
  while (next.phase !== "idle" && !isPaused(next)
      && next.endsAtMs > 0 && next.endsAtMs <= Number(nowMs) && guard < 64) {
    next = completePhase(next, next.endsAtMs, config)
    guard += 1
  }
  return next
}

// Validated parse of the state file; anything malformed is a fresh idle.
function parseState(text) {
  var parsed = null
  if (typeof text === "string" && text.length > 0) {
    try { parsed = JSON.parse(text) } catch (error) { parsed = null }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return idleState()
  var state = idleState()
  if (PHASES.indexOf(parsed.phase) !== -1) state.phase = parsed.phase
  var numbers = ["endsAtMs", "pausedRemainingMs", "cycleCount", "todayCount"]
  for (var i = 0; i < numbers.length; i++) {
    var value = Number(parsed[numbers[i]])
    if (isFinite(value) && value >= 0) state[numbers[i]] = value
  }
  if (typeof parsed.todayDate === "string") state.todayDate = parsed.todayDate
  state.dndWasOn = parsed.dndWasOn === true
  return state
}

function serializeState(state) {
  return JSON.stringify({
    phase: state.phase,
    endsAtMs: state.endsAtMs,
    pausedRemainingMs: state.pausedRemainingMs,
    cycleCount: state.cycleCount,
    todayCount: state.todayCount,
    todayDate: state.todayDate,
    dndWasOn: state.dndWasOn === true
  }, null, 2) + "\n"
}

function statePath(xdgStateHome, home) {
  var base = typeof xdgStateHome === "string" && xdgStateHome.trim().length > 0
    ? xdgStateHome.trim()
    : String(home == null ? "" : home) + "/.local/state"
  return base + "/omarchy/pomodoro.json"
}

function formatRemaining(ms) {
  var total = Math.ceil(Math.max(0, Number(ms)) / 1000)
  var minutes = Math.floor(total / 60)
  var seconds = total % 60
  return minutes + ":" + (seconds < 10 ? "0" + seconds : String(seconds))
}

function glyphFor(phase) {
  if (phase === "work") return "󰔟"
  if (phase === "break" || phase === "longBreak") return "󰅶"
  return "󱎫"
}

function labelFor(phase) {
  if (phase === "work") return "Focus"
  if (phase === "break") return "Break"
  if (phase === "longBreak") return "Long break"
  return "Pomodoro"
}

if (typeof module !== "undefined") {
  module.exports = {
    PHASES: PHASES,
    DEFAULTS: DEFAULTS,
    idleState: idleState,
    readConfig: readConfig,
    phaseDurationMs: phaseDurationMs,
    nextPhase: nextPhase,
    dayKey: dayKey,
    startPhase: startPhase,
    pause: pause,
    resume: resume,
    isPaused: isPaused,
    remainingMs: remainingMs,
    completePhase: completePhase,
    resolveState: resolveState,
    parseState: parseState,
    serializeState: serializeState,
    statePath: statePath,
    formatRemaining: formatRemaining,
    glyphFor: glyphFor,
    labelFor: labelFor
  }
}
