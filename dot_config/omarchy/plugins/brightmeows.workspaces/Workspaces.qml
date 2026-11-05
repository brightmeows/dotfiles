import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import qs.Commons
import qs.Ui

// Workspace switcher with two additions over the stock omarchy.workspaces:
//
//   * New-window dot: a workspace that received a window while it was not
//     visible on any monitor shows a small dot under its number until the
//     workspace becomes visible.
//   * Bell dot: an Alacritty bell (e.g. pi's questionnaire waiting for input)
//     runs bell-flag.sh, which records the bell window's workspace; the dot
//     uses the bar's urgent color until the workspace becomes visible.
//
// 4.5 gives every monitor its own block of ten workspaces. The stock helpers
// below keep each bar on its monitor's block; the dots stay keyed by the
// global workspace id Hyprland reports, so a workspace on the external monitor
// (11-20) lights the same dot as one on the laptop panel (1-10).
//
// 本插件只做圆点标记；窗口落位由 meow-launch 与 initial_workspace_tracking
// 接管，决策表见 ~/.config/hypr/WORKSPACES.md。
// See README.md for the manual re-enable step after `omarchy refresh shell`.

BarWidget {
  id: root
  moduleName: "omarchy.workspaces"

  // ---------------------------------------------------------------------
  // Stock workspace switcher helpers.
  // ---------------------------------------------------------------------

  // Every monitor has workspaces 1-10 of its own, which Hyprland numbers in a
  // block of ten per monitor: 1-10, 11-20, and so on (see
  // default/hypr/monitor-workspaces.lua). Each bar shows its own monitor's
  // block, numbered 1-10, and the one that monitor shows.
  readonly property int slots: 10

  readonly property var monitor: {
    var window = root.QsWindow.window
    var screen = window ? window.screen : null
    return screen ? Hyprland.monitorFor(screen) : Hyprland.focusedMonitor
  }
  readonly property string monitorName: root.monitor ? root.monitor.name : ""

  // Connector -> block, from the file Hyprland keeps them in.
  property var blocks: ({})

  function readBlocks(text) {
    var next = {}
    var lines = String(text || "").split("\n")
    for (var i = 0; i < lines.length; i++) {
      var fields = lines[i].split("\t")
      if (fields.length >= 3 && fields[1] !== "") next[fields[1]] = parseInt(fields[0], 10)
    }
    root.blocks = next
  }

  FileView {
    path: (Quickshell.env("XDG_STATE_HOME") || Quickshell.env("HOME") + "/.local/state") + "/omarchy/monitor-workspaces"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.readBlocks(text())
    onLoadFailed: root.readBlocks("")
  }

  // The layout toggle writes (or removes) the active workspace's mode file and
  // then asks the stock omarchy.workspaces IPC handler to refresh. That handler
  // belongs to the first-party widget, whose module id is not this clone's, so
  // watch the same file directly and refresh when it changes.
  readonly property string modeFilePath: {
    var id = root.activeWorkspaceId()
    if (id < 1) return ""
    return (Quickshell.env("XDG_STATE_HOME") || Quickshell.env("HOME") + "/.local/state") +
      "/omarchy/workspace-layouts/" + id + ".lua"
  }

  FileView {
    path: root.modeFilePath
    watchChanges: true
    printErrors: false
    onFileChanged: root.refresh()
    onLoaded: root.refresh()
    onLoadFailed: root.refresh()
  }

  function blockOf(id) {
    return Math.floor((id - 1) / root.slots)
  }

  function slotOf(id) {
    return (id - 1) % root.slots + 1
  }

  function activeWorkspaceId() {
    return root.monitor && root.monitor.activeWorkspace ? root.monitor.activeWorkspace.id : -1
  }

  // Until Hyprland has written the file, the workspace a monitor shows is in
  // its own block.
  readonly property int block: {
    var block = root.blocks[root.monitorName]
    if (block !== undefined) return block
    var active = root.activeWorkspaceId()
    return active > 0 ? root.blockOf(active) : 0
  }

  function workspaceById(id) {
    var values = Hyprland.workspaces.values
    for (var i = 0; i < values.length; i++) {
      if (values[i].id === id) return values[i]
    }

    return null
  }

  // The first five of the monitor's own, and any of the rest that exist. After
  // them come workspaces that are only visiting: those of a monitor that is
  // unplugged, which had no room to join this one's.
  function workspaceIds() {
    var base = root.block * root.slots
    var ids = [base + 1, base + 2, base + 3, base + 4, base + 5]
    var guests = []
    var values = Hyprland.workspaces.values

    for (var i = 0; i < values.length; i++) {
      var id = values[i].id
      if (id <= 0) continue
      if (root.blockOf(id) === root.block) {
        if (ids.indexOf(id) === -1) ids.push(id)
      } else if (values[i].monitor && values[i].monitor.name === root.monitorName) {
        guests.push(id)
      }
    }

    ids.sort(function(left, right) { return left - right })
    guests.sort(function(left, right) { return left - right })
    return ids.concat(guests)
  }

  function dispatch(expression) {
    if (root.bar) root.bar.run("hyprctl dispatch " + Util.shellQuote(expression))
  }

  function focusWorkspace(id) {
    if (root.blockOf(id) === root.block) {
      root.dispatch("o.workspaces.focus(" + root.slotOf(id) + ", \"" + root.monitorName + "\")")
    } else {
      root.dispatch("hl.dsp.focus({ workspace = \"" + id + "\" })")
    }
  }

  // A wheel notch moves one entry along the row, and a touchpad adds up its
  // smaller deltas until they make a notch's worth.
  property real wheelAccumulator: 0

  function scrollWorkspaces(delta) {
    var wheel = Util.wheelSteps(root.wheelAccumulator, delta)
    root.wheelAccumulator = wheel.remainder
    if (wheel.steps === 0) return

    // Holds at either end rather than wrapping, so a touchpad swipe that runs
    // long stops on the last workspace.
    var ids = root.workspaceIds()
    var index = ids.indexOf(root.activeWorkspaceId())
    if (index === -1) return
    var target = ids[Util.clamp(index - wheel.steps, 0, ids.length - 1)]
    if (target !== ids[index]) root.focusWorkspace(target)
  }

  // The workspace each monitor shows carries its layout: a square tiles, a
  // circle scrolls, and a triangle floats. Clicking it cycles to the next one,
  // as Super + L does.
  property string activeMode: "dwindle"
  property bool modeStale: false

  function modeGlyph(mode) {
    if (mode === "scrolling") return "󰝥"
    if (mode === "floating") return "󰔶"
    return "󱓻"
  }

  // A layout only changes through the layout commands, which ask for a refresh,
  // or a config reload, so each workspace's mode is read once and cached rather
  // than running the script on every workspace switch.
  property var modeCache: ({})
  property int modeGeneration: 0
  property int modeProcWorkspace: -1
  property int modeProcGeneration: 0

  function showActiveMode() {
    var mode = root.modeCache[root.activeWorkspaceId()]
    if (mode !== undefined) root.activeMode = mode
    else readMode()
  }

  function readMode() {
    if (modeProc.running) {
      root.modeStale = true
      return
    }
    var id = root.activeWorkspaceId()
    if (id === -1) return
    root.modeProcWorkspace = id
    root.modeProcGeneration = root.modeGeneration
    modeProc.command = ["omarchy-hyprland-workspace-layout-current", String(id)]
    modeProc.running = true
  }

  function refresh() {
    root.modeCache = ({})
    root.modeGeneration++
    readMode()
  }

  // The layout commands act on the focused workspace, so a click on another
  // monitor's bar focuses that monitor first.
  function cycleLayout() {
    if (!root.bar) return
    var command = "omarchy-hyprland-workspace-layout-toggle"
    if (root.monitor && !root.monitor.focused) {
      command = "hyprctl dispatch " + Util.shellQuote("hl.dsp.focus({ monitor = \"" + root.monitorName + "\" })") + " >/dev/null && " + command
    }
    root.bar.run(command)
  }

  // ---------------------------------------------------------------------
  // New-window state.
  // ---------------------------------------------------------------------

  // Workspaces that received a new window while invisible on every monitor.
  // Replaced wholesale on each change so bindings re-evaluate.
  property var flaggedWorkspaces: []

  function isFlagged(id) {
    return flaggedWorkspaces.indexOf(id) !== -1
  }

  // Global workspace ids stay positive for every monitor block. Named and
  // special workspaces are not part of the numeric bar, so they return 0.
  function workspaceNumber(name) {
    var text = String(name || "")
    if (!/^[0-9]+$/.test(text)) return 0
    var id = Number(text)
    return id >= 1 ? id : 0
  }

  function workspaceVisible(id) {
    var monitors = Hyprland.monitors.values
    for (var i = 0; i < monitors.length; i++) {
      var workspace = monitors[i].activeWorkspace
      if (workspace && workspace.id === id) return true
    }

    return false
  }

  function flagWorkspace(id) {
    if (!id || isFlagged(id)) return
    var next = flaggedWorkspaces.slice()
    next.push(id)
    flaggedWorkspaces = next
  }

  function unflagWorkspace(id) {
    var index = flaggedWorkspaces.indexOf(id)
    if (index === -1) return
    var next = flaggedWorkspaces.slice()
    next.splice(index, 1)
    flaggedWorkspaces = next
  }

  function clearVisibleFlags() {
    var current = flaggedWorkspaces
    for (var i = 0; i < current.length; i++) {
      if (workspaceVisible(current[i])) unflagWorkspace(current[i])
    }

    var bells = bellFlagged
    for (var j = 0; j < bells.length; j++) {
      if (workspaceVisible(bells[j])) unflagBell(bells[j])
    }
  }

  // ---------------------------------------------------------------------
  // Bell flag state.
  // ---------------------------------------------------------------------

  // Workspaces whose alacritty window rang (bell-flag.sh event files).
  // Kept separate from new-window flags so the dot can pick a color.
  property var bellFlagged: []
  // Event files older than this are consumed without flagging (stale bells).
  readonly property int bellMaxAgeSec: 600

  function isBellFlagged(id) {
    return bellFlagged.indexOf(id) !== -1
  }

  function flagBell(id) {
    if (!id || isBellFlagged(id)) return
    var next = bellFlagged.slice()
    next.push(id)
    bellFlagged = next
  }

  function unflagBell(id) {
    var index = bellFlagged.indexOf(id)
    if (index === -1) return
    var next = bellFlagged.slice()
    next.splice(index, 1)
    bellFlagged = next
  }

  // Consume one poll of "<path> <workspace> <mtime>" lines: flag fresh
  // events, drop stale ones, and let a single bar surface delete the files
  // so the other bars keep their flags without racing on rm.
  function consumeBellEvents(raw) {
    var lines = String(raw || "").split("\n")
    var consumed = []
    var nowSec = Date.now() / 1000
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i]
      if (!line) continue
      var parts = line.split(" ")
      if (parts.length < 3) continue
      var id = Number(parts[1])
      if (!id) continue
      var ageSec = nowSec - Number(parts[2])
      if (isNaN(ageSec) || ageSec > root.bellMaxAgeSec) {
        consumed.push(parts[0])
        continue
      }
      flagBell(id)
      consumed.push(parts[0])
    }
    if (consumed.length === 0 || !isFileCleaner()) return
    Quickshell.execDetached(["rm", "-f"].concat(consumed))
  }

  // One bar surface deletes the consumed event files; the others only keep
  // their flags in sync, so a two-monitor bar never races on rm.
  function isFileCleaner() {
    if (!bar || typeof bar.moduleWidgets !== "function") return true
    var widgets = bar.moduleWidgets(moduleName)
    return widgets.length === 0 || widgets[0] === root
  }

  function onOpenWindow(address, landed, className) {
    // meow-launch 已在 map 前决定窗口工作区；此处只做圆点标记：
    // 新窗口落在任一显示器都不可见的工作区时点亮圆点。
    var id = workspaceNumber(landed)
    if (id && !workspaceVisible(id)) flagWorkspace(id)
  }

  Component.onCompleted: refresh()
  onMonitorChanged: root.showActiveMode()

  Connections {
    target: root.monitor
    function onActiveWorkspaceChanged() { root.showActiveMode() }
  }

  // ---------------------------------------------------------------------
  // Hyprland events.
  // ---------------------------------------------------------------------

  Connections {
    target: Hyprland

    function onRawEvent(event) {
      var name = event ? String(event.name) : ""

      if (name === "openwindow") {
        var parts = event.parse(4)
        if (parts.length >= 3) {
          root.onOpenWindow(String(parts[0]), String(parts[1]), String(parts[2]))
        }
      }

      if (name === "workspacev2" || name === "workspace" || name === "focusedmon" || name === "focusedmonv2" || name === "moveworkspacev2") {
        root.clearVisibleFlags()
      }

      if (name === "configreloaded") root.refresh()
      // Quickshell credits every workspace switch to the focused monitor, as
      // the event doesn't say which one switched, and misses the workspace a
      // monitor falls back to when its own is moved away. Moving workspaces
      // between monitors switches the others, so ask Hyprland for the truth.
      // A workspace that changes number is only learned by asking too. Every
      // bar shares what Hyprland answers, so one asks after a plain switch.
      var switched = name === "workspacev2" && root.monitor !== null && root.monitor.focused
      if (switched || name === "moveworkspacev2" || name === "changeworkspaceid") {
        Hyprland.refreshMonitors()
        Hyprland.refreshWorkspaces()
      }
    }
  }

  Process {
    id: modeProc
    stdout: StdioCollector {
      onStreamFinished: {
        var mode = text.trim()
        // A read that started before a refresh may predate the change.
        if (!mode || root.modeProcGeneration !== root.modeGeneration) return
        root.modeCache[root.modeProcWorkspace] = mode
        if (root.modeProcWorkspace === root.activeWorkspaceId()) root.activeMode = mode
      }
    }
    onExited: {
      if (!root.modeStale) return
      root.modeStale = false
      // Deferred: the process still reports running while it signals exit.
      Qt.callLater(root.showActiveMode)
    }
  }

  // Bell event files from bell-flag.sh, polled once a second.
  Process {
    id: bellScan
    command: ["sh", "-c", "for f in \"$1\"/*; do [ -f \"$f\" ] || continue; printf '%s %s %s\\n' \"$f\" \"$(cat \"$f\")\" \"$(stat -c %Y \"$f\")\"; done", "sh", (Quickshell.env("XDG_CACHE_HOME") || (Quickshell.env("HOME") + "/.cache")) + "/omarchy/bell-flags"]

    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.consumeBellEvents(text)
    }
  }

  Timer {
    interval: 1000
    running: true
    repeat: true
    onTriggered: if (!bellScan.running) bellScan.running = true
  }

  // ---------------------------------------------------------------------
  // Bar UI (stock layout, plus the visibility dot).
  // ---------------------------------------------------------------------

  readonly property real trailingGap: root.vertical ? 0 : Style.spaceReal(1.5)

  implicitWidth: grid.implicitWidth + trailingGap
  implicitHeight: grid.implicitHeight

  GridLayout {
    id: grid
    anchors.fill: parent
    anchors.rightMargin: root.trailingGap
    columns: root.vertical ? 1 : root.workspaceIds().length
    columnSpacing: root.vertical ? 0 : Style.space(1)
    rowSpacing: root.vertical ? Style.space(2) : 0

    Repeater {
      model: root.workspaceIds()

      WidgetButton {
        required property int modelData

        readonly property var workspace: root.workspaceById(modelData)
        readonly property bool occupied: workspace !== null && workspace.toplevels.values.length > 0
        readonly property bool shown: root.monitor !== null && root.monitor.activeWorkspace !== null && root.monitor.activeWorkspace.id === modelData
        readonly property int slot: root.slotOf(modelData)
        readonly property bool firstGuest: root.blockOf(modelData) !== root.block && index > 0 && root.blockOf(root.workspaceIds()[index - 1]) === root.block
        required property int index

        // A gap sets visiting workspaces apart from the monitor's own.
        Layout.leftMargin: firstGuest && !root.vertical ? Style.space(6) : 0
        Layout.topMargin: firstGuest && root.vertical ? Style.space(6) : 0

        bar: root.bar
        text: shown ? root.modeGlyph(root.activeMode) : (slot === root.slots ? "0" : String(slot))
        opacity: occupied || shown ? 1 : 0.5
        horizontalMargin: 6
        verticalPadding: 6
        fixedWidth: root.vertical ? root.barSize : Style.space(20)
        fixedHeight: root.barSize
        onPressed: function() {
          if (shown) root.cycleLayout()
          else root.focusWorkspace(modelData)
        }
        onWheelMoved: function(delta) { root.scrollWorkspaces(delta) }

        // New-window/bell dot, drawn inside the slot so it never shifts
        // layout. Bell takes the urgent color; new window keeps the accent.
        Rectangle {
          visible: root.isFlagged(modelData) || root.isBellFlagged(modelData)
          color: root.isBellFlagged(modelData) && root.bar ? root.bar.urgent : Color.accent
          width: Style.space(2)
          height: width
          radius: width / 2
          z: 10

          anchors.horizontalCenter: root.vertical ? undefined : parent.horizontalCenter
          anchors.bottom: root.vertical ? undefined : parent.bottom
          anchors.bottomMargin: root.vertical ? 0 : Style.space(1)
          anchors.verticalCenter: root.vertical ? parent.verticalCenter : undefined
          anchors.right: root.vertical ? parent.right : undefined
          anchors.rightMargin: root.vertical ? Style.space(1) : 0
        }
      }
    }
  }
}
