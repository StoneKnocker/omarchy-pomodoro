import QtQuick
import QtQuick.Window
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "model/PomodoroModel.js" as PomodoroModel

// Pomodoro focus timer in the bar. The whole session lives in a state file
// (endsAt against the wall clock), so it survives shell restarts and every
// per-monitor bar instance renders the same session. Exactly one instance —
// the one on the first screen — runs side effects (phase transitions, DND,
// notifications), so nothing fires twice on multi-monitor setups.
//
// A phase that hits 0 returns to idle and notifies; the next round starts
// only when the user clicks. Skip and reset do not count unfinished work.
//
// Left click: start / pause / resume. Right click: skip phase.
// Middle click: reset. Auto-DND silences notifications during focus.
BarWidget {
  id: root
  moduleName: "community.pomodoro"

  readonly property var config: PomodoroModel.readConfig(settings)
  readonly property string stateFile: PomodoroModel.statePath(
    Quickshell.env("XDG_STATE_HOME"), Quickshell.env("HOME"))

  property var session: PomodoroModel.idleState()
  property double nowMs: Date.now()

  // Side-effect leadership: the instance whose window sits on the first
  // screen. Recomputed reactively if screens change.
  readonly property bool leader: {
    var screens = Quickshell.screens || []
    return screens.length === 0 || String(Screen.name) === String(screens[0].name)
  }

  readonly property bool running: session.phase !== "idle" && !PomodoroModel.isPaused(session)
  readonly property real remaining: PomodoroModel.remainingMs(session, nowMs)

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  FileView {
    id: stateReader
    path: root.stateFile
    printErrors: false
    watchChanges: true
    onLoaded: root.session = PomodoroModel.parseState(text())
    onLoadFailed: root.session = PomodoroModel.idleState()
    onFileChanged: reload()
  }

  FileView {
    id: stateWriter
    path: root.stateFile
    printErrors: false
    atomicWrites: true
    // Keep the write-compare cache tracking disk (setText de-dupes).
    onSaved: reload()
  }

  function persist(next) {
    session = next
    stateWriter.setText(PomodoroModel.serializeState(next))
  }

  // The tick only runs while a session is actively counting down; an idle
  // or paused chip costs nothing.
  Timer {
    running: root.running
    interval: 1000
    repeat: true
    triggeredOnStart: true
    onTriggered: {
      root.nowMs = Date.now()
      if (root.leader && root.remaining <= 0) root.advancePhase()
    }
  }

  // Reconcile a stale on-disk session once at startup (leader only, so the
  // completion side effects fire once).
  Timer {
    running: root.leader && root.session.phase !== "idle"
      && !PomodoroModel.isPaused(root.session)
      && root.session.endsAtMs > 0 && root.session.endsAtMs <= root.nowMs
    interval: 250
    onTriggered: root.advancePhase()
  }

  function advancePhase() {
    var before = session.phase
    var resolved = PomodoroModel.resolveState(session, Date.now(), config)
    if (resolved.phase === before && PomodoroModel.remainingMs(resolved, Date.now()) > 0) return
    var next = resolved.phase === before
      ? PomodoroModel.completePhase(resolved, Date.now(), config) : resolved
    applyDnd(next)
    notifyTransition(before, next)
    persist(next)
  }

  function startOrToggle() {
    var now = Date.now()
    if (session.phase === "idle") {
      var started = PomodoroModel.startPhase(
        session, PomodoroModel.phaseToStart(session), now, config)
      started.dndWasOn = dndActive()
      applyDnd(started)
      persist(started)
    } else if (PomodoroModel.isPaused(session)) {
      persist(PomodoroModel.resume(session, now))
    } else {
      persist(PomodoroModel.pause(session, now))
    }
  }

  function skipPhase() {
    if (session.phase === "idle") return
    var next = PomodoroModel.skipPhase(session, Date.now(), config)
    applyDnd(next)
    persist(next)
  }

  function reset() {
    var idle = PomodoroModel.idleState()
    idle.todayCount = session.todayCount
    idle.todayDate = session.todayDate
    idle.dndWasOn = session.dndWasOn
    applyDnd(idle)
    persist(idle)
  }

  // ---- side effects (leader-gated where they would duplicate) --------------
  function dndService() {
    var host = bar && bar.shell && typeof bar.shell.serviceFor === "function" ? bar.shell : null
    return host ? host.serviceFor("omarchy.notifications") : null
  }

  function dndActive() {
    var service = dndService()
    return service ? service.doNotDisturb === true : false
  }

  // DND follows the phase: on during focus, restored to the pre-session
  // state otherwise. Setting the same value twice is harmless, but only the
  // leader drives it so multi-monitor setups act once.
  function applyDnd(state) {
    if (!leader || !config.autoDnd) return
    var service = dndService()
    if (!service || typeof service.setDoNotDisturb !== "function") return
    if (state.phase === "work") service.setDoNotDisturb(true)
    else service.setDoNotDisturb(state.dndWasOn === true)
  }

  function notifyTransition(fromPhase, state) {
    if (!leader || fromPhase === state.phase) return
    var notice = PomodoroModel.completionNotice(fromPhase, state)
    if (!notice) return
    // App name "notify-send" + critical is the shell's DND-bypass so the
    // reminder is visible even if the user had Do Not Disturb on before
    // the session (applyDnd restores that preference first).
    notifyProcess.command = ["notify-send", "-u", "critical", "-a", "notify-send", notice.title, notice.body]
    notifyProcess.running = true
  }

  Process {
    id: notifyProcess
    command: ["notify-send", "-u", "critical", "-a", "notify-send", "Pomodoro", ""]
  }

  // Scriptable surface: omarchy-shell community.pomodoro toggle|skip|reset|status
  IpcHandler {
    target: "community.pomodoro"

    function toggle(): string {
      root.startOrToggle()
      return root.session.phase
    }

    function skip(): string {
      root.skipPhase()
      return root.session.phase
    }

    function reset(): string {
      root.reset()
      return "idle"
    }

    function status(): string {
      return JSON.stringify({
        phase: root.session.phase,
        paused: PomodoroModel.isPaused(root.session),
        remainingMs: Math.round(root.remaining),
        cycleCount: root.session.cycleCount,
        todayCount: root.session.todayCount
      })
    }
  }

  WidgetButton {
    id: button
    bar: root.bar
    active: root.session.phase === "work" && !PomodoroModel.isPaused(root.session)
    dimmed: PomodoroModel.isPaused(root.session)
    text: root.session.phase === "idle"
      ? PomodoroModel.glyphFor("idle")
      : PomodoroModel.glyphFor(root.session.phase) + " " + PomodoroModel.formatRemaining(root.remaining)
    tooltipText: root.session.phase === "idle"
      ? "Pomodoro — click to start "
        + PomodoroModel.startLabel(PomodoroModel.phaseToStart(root.session))
        + " (" + root.session.todayCount + " done today)"
      : PomodoroModel.labelFor(root.session.phase)
        + (PomodoroModel.isPaused(root.session) ? " (paused)" : "")
        + " — " + root.session.todayCount + " done today · right-click skips, middle resets"
    onPressed: function (mouseButton) {
      if (mouseButton === Qt.RightButton) root.skipPhase()
      else if (mouseButton === Qt.MiddleButton) root.reset()
      else root.startOrToggle()
    }
  }
}
