// Pomodoro engine model. Loaded by both the QML widget and the Node test
// harness, so it must stay dependency-free.
//
// The whole session lives in a small state object persisted to a state file:
//   { phase, endsAtMs, pausedRemainingMs, cycleCount, todayCount, todayDate,
//     dndWasOn, pendingPhase }
// Remaining time derives from endsAtMs against the wall clock, so a shell
// restart mid-session resumes exactly. A phase that fully elapsed while the
// shell was down still counts as done — but the next phase does not auto-start;
// the chip returns to idle with pendingPhase set, and a notification asks the
// user to click when they are ready. Only a work phase that actually reached
// 0 remaining increments todayCount / cycleCount.

var PHASES = ["idle", "work", "break"]

var DEFAULTS = {
  workMinutes: 25,
  breakMinutes: 5,
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
    dndWasOn: false,
    pendingPhase: "work"
  }
}

// Read widget settings with validation; invalid values fall back.
function readConfig(settings) {
  var s = settings || {}
  function minutes(value, fallback) {
    var n = Number(value)
    return isFinite(n) && n >= 1 && n <= 240 ? Math.floor(n) : fallback
  }
  return {
    workMinutes: minutes(s.workMinutes, DEFAULTS.workMinutes),
    breakMinutes: minutes(s.breakMinutes, DEFAULTS.breakMinutes),
    autoDnd: s.autoDnd === false ? false : DEFAULTS.autoDnd
  }
}

function phaseDurationMs(phase, config) {
  if (phase === "work") return config.workMinutes * 60000
  if (phase === "break") return config.breakMinutes * 60000
  return 0
}

// The phase that follows a completed one. Work always yields a short break.
function nextPhase(completedPhase) {
  return completedPhase === "work" ? "break" : "work"
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

function normalizedPhase(phase) {
  if (phase === "longBreak") return "break"
  if (PHASES.indexOf(phase) !== -1) return phase
  return "idle"
}

function normalizedPending(phase) {
  if (phase === "break" || phase === "longBreak") return "break"
  return "work"
}

function cloneState(state) {
  return {
    phase: normalizedPhase(state.phase),
    endsAtMs: state.endsAtMs,
    pausedRemainingMs: state.pausedRemainingMs,
    cycleCount: state.cycleCount,
    todayCount: state.todayCount,
    todayDate: state.todayDate,
    dndWasOn: state.dndWasOn === true,
    pendingPhase: normalizedPending(state.pendingPhase)
  }
}

// Phase to begin from idle: the one waiting after a completed (or skipped)
// phase, otherwise a fresh focus session.
function phaseToStart(state) {
  return normalizedPending(state && state.pendingPhase)
}

// Start a phase now.
function startPhase(state, phase, nowMs, config) {
  var next = withToday(state, nowMs)
  next.phase = normalizedPhase(phase)
  next.endsAtMs = Number(nowMs) + phaseDurationMs(next.phase, config)
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

// Natural completion of a phase whose remaining time has hit 0. Counts a
// finished work session, then returns to idle with pendingPhase set so the
// next round does not auto-start.
function completePhase(state, nowMs, config) {
  var next = withToday(cloneState(state), nowMs)
  if (next.phase === "idle") return next
  var finished = remainingMs(next, nowMs) <= 0
  if (next.phase === "work" && finished) {
    next.cycleCount = next.cycleCount + 1
    next.todayCount = next.todayCount + 1
  }
  next.pendingPhase = nextPhase(next.phase)
  next.phase = "idle"
  next.endsAtMs = 0
  next.pausedRemainingMs = 0
  return next
}

// User skip: jump to the next phase immediately without treating an
// unfinished work period as done. Incomplete work still yields a break.
function skipPhase(state, nowMs, config) {
  var next = withToday(cloneState(state), nowMs)
  if (next.phase === "idle") return next
  var following = nextPhase(next.phase)
  next.pendingPhase = following
  return startPhase(next, following, nowMs, config)
}

// Copy for the end-of-phase desktop notification. null if this transition
// is not a completion (e.g. idle → work on user click).
function completionNotice(fromPhase, state) {
  if (fromPhase === "work") {
    return {
      title: "Focus complete",
      body: state.todayCount + " done today. Click the bar to start your break."
    }
  }
  if (fromPhase === "break" || fromPhase === "longBreak") {
    return { title: "Break over", body: "Click the bar to start focusing." }
  }
  return null
}

function notificationExecArgv(phase) {
  var target = normalizedPending(phase)
  return ["omarchy-shell", "community.pomodoro", "startPhase", target]
}

// Reconcile persisted state against the wall clock after a load: a running
// phase whose end passed while we were away completes once (and stops at
// idle). We never chain through later phases — that would auto-start and
// inflate today's count.
function resolveState(state, nowMs, config) {
  var next = withToday(state, nowMs)
  if (next.phase !== "idle" && !isPaused(next)
      && next.endsAtMs > 0 && next.endsAtMs <= Number(nowMs)) {
    next = completePhase(next, next.endsAtMs, config)
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
  state.phase = normalizedPhase(parsed.phase)
  var numbers = ["endsAtMs", "pausedRemainingMs", "cycleCount", "todayCount"]
  for (var i = 0; i < numbers.length; i++) {
    var value = Number(parsed[numbers[i]])
    if (isFinite(value) && value >= 0) state[numbers[i]] = value
  }
  if (typeof parsed.todayDate === "string") state.todayDate = parsed.todayDate
  state.dndWasOn = parsed.dndWasOn === true
  state.pendingPhase = normalizedPending(parsed.pendingPhase)
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
    dndWasOn: state.dndWasOn === true,
    pendingPhase: normalizedPending(state.pendingPhase)
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
  if (phase === "break") return "󰅶"
  return "󱎫"
}

function labelFor(phase) {
  if (phase === "work") return "Focus"
  if (phase === "break") return "Break"
  return "Pomodoro"
}

function startLabel(phase) {
  if (phase === "break") return "a break"
  return "a focus session"
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
    skipPhase: skipPhase,
    phaseToStart: phaseToStart,
    completionNotice: completionNotice,
    resolveState: resolveState,
    parseState: parseState,
    serializeState: serializeState,
    statePath: statePath,
    formatRemaining: formatRemaining,
    glyphFor: glyphFor,
    labelFor: labelFor,
    startLabel: startLabel,
    normalizedPhase: normalizedPhase,
    notificationExecArgv: notificationExecArgv
  }
}
