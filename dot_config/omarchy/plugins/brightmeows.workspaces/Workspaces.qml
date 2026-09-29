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
// 历史注记：本插件曾有“新窗口跟随进程”的事后搬迁逻辑（同进程在其他工作区
// 已有窗口时，把新窗口静默搬过去）。2026-09 由菜单/绑定侧的 meow-launch
// 接管窗口落位（compositor exec 规则在 map 前决定工作区），搬迁逻辑因
// 闪动、抢焦点、覆盖面不足而移除，openwindow 事件仅保留圆点标记职责。
//
// See README.md for the manual re-enable step after `omarchy refresh shell`.

BarWidget {
  id: root
  moduleName: "omarchy.workspaces"

  // ---------------------------------------------------------------------
  // Stock workspace switcher helpers (unchanged from omarchy.workspaces).
  // ---------------------------------------------------------------------

  function workspaceById(id) {
    var values = Hyprland.workspaces.values
    for (var i = 0; i < values.length; i++) {
      if (values[i].id === id) return values[i]
    }

    return null
  }

  function workspaceIds() {
    var ids = [1, 2, 3, 4, 5]
    var values = Hyprland.workspaces.values

    for (var i = 0; i < values.length; i++) {
      var id = values[i].id
      if (id > 0 && id <= 10 && ids.indexOf(id) === -1) ids.push(id)
    }

    ids.sort(function(left, right) { return left - right })
    return ids
  }

  function focusWorkspace(id) {
    if (!root.bar) return
    root.bar.run("hyprctl dispatch " + Util.shellQuote("hl.dsp.focus({ workspace = \"" + id + "\" })"))
  }

  readonly property real trailingGap: root.vertical ? 0 : Style.spaceReal(1.5)

  // ---------------------------------------------------------------------
  // New-window state.
  // ---------------------------------------------------------------------

  // Workspaces that received a new window while invisible on every monitor.
  // Replaced wholesale on each change so bindings re-evaluate.
  property var flaggedWorkspaces: []

  function isFlagged(id) {
    return flaggedWorkspaces.indexOf(id) !== -1
  }

  function workspaceNumber(name) {
    var text = String(name || "")
    if (!/^[0-9]+$/.test(text)) return 0
    var id = Number(text)
    return id >= 1 && id <= 10 ? id : 0
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

  // ---------------------------------------------------------------------
  // Hyprland events.
  // ---------------------------------------------------------------------

  Connections {
    target: Hyprland

    function onRawEvent(event) {
      if (event.name === "openwindow") {
        var parts = event.parse(4)
        if (parts.length < 3) return
        root.onOpenWindow(String(parts[0]), String(parts[1]), String(parts[2]))
      } else if (event.name === "workspacev2" || event.name === "workspace" || event.name === "focusedmon" || event.name === "focusedmonv2" || event.name === "moveworkspacev2") {
        root.clearVisibleFlags()
      }
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
  // Bar UI (stock layout, plus the new-window dot).
  // ---------------------------------------------------------------------

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
        readonly property bool focused: Hyprland.focusedWorkspace !== null && Hyprland.focusedWorkspace.id === modelData

        bar: root.bar
        text: focused ? "\uDB85\uDCFB" : (modelData === 10 ? "0" : String(modelData))
        opacity: occupied || focused ? 1 : 0.5
        horizontalMargin: 6
        verticalPadding: 6
        fixedWidth: root.vertical ? root.barSize : Style.space(20)
        fixedHeight: root.barSize
        onPressed: function() { root.focusWorkspace(modelData) }

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
