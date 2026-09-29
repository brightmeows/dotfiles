import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import qs.Commons
import qs.Ui

// Bar title for the active window of the monitor this bar is on.
//
// The built-in omarchy.active-window shows the globally focused window on
// every monitor's bar. This plugin scopes the title to the monitor the bar
// belongs to: each surface shows the most recently focused window that is
// currently visible on that monitor (its active workspace plus a special
// workspace currently shown there), and hides when the monitor shows no
// windows at all.
//
// Data comes from `hyprctl -j monitors` and `hyprctl -j clients` instead of
// Quickshell's Hyprland types because per-window focusHistoryID (the ranking
// used to pick the most recently focused window) is not exposed as a QML
// property, and `lastIpcObject` only refreshes on Hyprland.refreshToplevels().
BarWidget {
  id: root

  moduleName: "brightmeows.active-window"

  // Screen this bar surface lives on; used to pick the right monitor entry
  // out of the hyprctl data. Bound through the QsWindow attached object,
  // which anything inside a Quickshell window exposes.
  readonly property string screenName: {
    var win = root.QsWindow.window
    return win && win.screen ? String(win.screen.name || "") : ""
  }

  // ---------------------------------------------------------------------
  // Active-window state.
  // ---------------------------------------------------------------------

  // Title shown in the bar; empty hides the widget.
  property string title: ""
  // Hyprland address of the window the title came from, for click actions.
  property string activeAddress: ""
  // A refresh runs at most once at a time; events landing while one is in
  // flight collapse into a single follow-up run.
  property bool refreshQueued: false

  readonly property int maxLabelWidth: Number(setting("maxWidth", 280))

  function clearTitle() {
    title = ""
    activeAddress = ""
  }

  // Ask for a fresh snapshot. The caller debounces event bursts first.
  function refresh() {
    if (refreshProcess.running) {
      refreshQueued = true
      return
    }

    refreshProcess.running = true
  }

  function requestRefresh() {
    refreshDebounce.restart()
  }

  // Both JSON documents arrive in one shell run separated by an ASCII record
  // separator, so a refresh is a single short-lived process and either both
  // results are current or neither is used.
  function applySnapshot(raw) {
    var parts = String(raw || "").split("\u001e")
    if (parts.length !== 2) return

    var monitors, clients
    try {
      monitors = JSON.parse(parts[0])
      clients = JSON.parse(parts[1])
    } catch (error) {
      return
    }

    if (!Array.isArray(monitors) || !Array.isArray(clients)) return

    var monitor = null
    for (var i = 0; i < monitors.length; i++) {
      if (String(monitors[i].name) === screenName) {
        monitor = monitors[i]
        break
      }
    }

    if (!monitor) {
      clearTitle()
      return
    }

    // Visible windows are those on the active workspace plus, while it is
    // actually shown on this monitor, its special workspace.
    var monitorId = Number(monitor.id)
    var visibleWorkspaces = {}
    if (monitor.activeWorkspace)
      visibleWorkspaces[Number(monitor.activeWorkspace.id)] = true
    if (monitor.specialWorkspace && Number(monitor.specialWorkspace.id) !== 0)
      visibleWorkspaces[Number(monitor.specialWorkspace.id)] = true

    var candidate = null
    for (var j = 0; j < clients.length; j++) {
      var client = clients[j]
      if (Number(client.monitor) !== monitorId) continue
      if (!client.workspace || !visibleWorkspaces[Number(client.workspace.id)]) continue

      // 0 is the currently focused window; smaller is more recent. Windows
      // that were never focused rank below every focused one and stay out.
      var history = Number(client.focusHistoryID)
      if (!isFinite(history) || history < 0) continue
      if (!candidate || history < Number(candidate.focusHistoryID)) candidate = client
    }

    if (!candidate) {
      clearTitle()
      return
    }

    activeAddress = String(candidate.address || "")
    title = String(candidate.title || candidate.class || "")
  }

  // Toplevel handle for the remembered address, used for click actions.
  function toplevelForActive() {
    var wanted = normalizeAddress(activeAddress)
    if (!wanted) return null

    var values = Hyprland.toplevels.values
    for (var i = 0; i < values.length; i++) {
      if (normalizeAddress(values[i].address) === wanted) return values[i].handle
    }

    return null
  }

  function normalizeAddress(value) {
    var text = String(value || "").toLowerCase()
    return text.indexOf("0x") === 0 ? text.substring(2) : text
  }

  Component.onCompleted: refresh()
  onScreenNameChanged: refresh()

  // Focus changes emit several events in a row; one snapshot is enough.
  Timer {
    id: refreshDebounce
    interval: 100
    repeat: false
    onTriggered: root.refresh()
  }

  Process {
    id: refreshProcess
    // The record separator cannot appear inside either JSON document.
    command: ["sh", "-c", "hyprctl -j monitors; printf '\\036'; hyprctl -j clients"]

    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.applySnapshot(text)
    }

    onExited: function(exitCode) {
      if (root.refreshQueued) {
        root.refreshQueued = false
        Qt.callLater(function() { root.refresh() })
      }
    }
  }

  Connections {
    target: Hyprland

    function onRawEvent(event) {
      switch (String(event.name)) {
      case "activewindow":
      case "activewindowv2":
      case "openwindow":
      case "closewindow":
      case "movewindow":
      case "movewindowv2":
      case "windowtitle":
      case "windowtitlev2":
      case "focusedmon":
      case "focusedmonv2":
      case "workspace":
      case "workspacev2":
      case "createworkspace":
      case "createworkspacev2":
      case "destroyworkspace":
      case "destroyworkspacev2":
      case "moveworkspace":
      case "moveworkspacev2":
      case "renameworkspace":
      case "activespecial":
      case "activespecialv2":
      case "fullscreen":
      case "changefloatingmode":
        root.requestRefresh()
        break
      }
    }
  }

  // ---------------------------------------------------------------------
  // Bar UI (stock omarchy.active-window visuals and interactions).
  // ---------------------------------------------------------------------

  visible: title !== "" && !vertical
  implicitWidth: visible ? Math.min(maxLabelWidth, labelText.implicitWidth) + Style.spacing.controlPaddingX * 2 : 0
  implicitHeight: barSize

  Behavior on implicitWidth {
    NumberAnimation {
      duration: 180
      easing.type: Easing.OutCubic
    }
  }

  Item {
    anchors.fill: parent
    anchors.leftMargin: Style.space(8)
    anchors.rightMargin: Style.space(8)
    clip: true

    Text {
      id: labelText
      textFormat: Text.PlainText
      anchors.verticalCenter: parent.verticalCenter
      anchors.left: parent.left
      width: parent.width
      text: root.title
      color: root.bar ? root.bar.barForeground : Color.foreground
      font.family: root.bar ? root.bar.fontFamily : Style.font.family
      font.pixelSize: Style.font.body
      elide: Text.ElideRight
      opacity: 0.85
    }
  }

  MouseArea {
    anchors.fill: parent
    hoverEnabled: true
    acceptedButtons: Qt.LeftButton | Qt.MiddleButton | Qt.RightButton
    cursorShape: Qt.PointingHandCursor

    onClicked: function(mouse) {
      var toplevel = root.toplevelForActive()
      if (!toplevel) return

      if (mouse.button === Qt.LeftButton) toplevel.activate()
      else toplevel.close()
    }

    onEntered: if (root.bar) root.bar.showTooltip(root, root.title)
    onExited: if (root.bar) root.bar.hideTooltip(root)
  }
}
