/**
 * dsh-herdr-state — 把 dsh 会话状态上报给 herdr，让 herdr 状态栏认得 dsh agent。
 *
 * 协议对齐 herdr 官方 pi 集成（herdr-agent-state.ts）：
 * unix socket + JSON 行，两个方法
 *   pane.report_agent_session — 登记会话（agent_session_id 引用）
 *   pane.report_agent        — working / blocked / idle + message + 单调 seq
 * 发送失败 500ms 后以 1500ms 重试一次；单飞行 + 队列只保最新态。
 *
 * 状态来源（dsh-pi-tui 扩展 API）：
 *   working/idle — Stable subscribeState 的 activity.working / session.busy
 *   blocked      — Advanced facade 轮询 ui.editor.getEditorState().composing
 *                  （审批动作面板或问卷覆盖编辑器座位时为 true）
 *
 * 仅在 herdr pane 内启用：HERDR_ENV=1 且有 HERDR_SOCKET_PATH、HERDR_PANE_ID。
 */
import net from "node:net";

const HERDR_ENV = process.env.HERDR_ENV;
const socketPath = process.env.HERDR_SOCKET_PATH;
const socketEndpoint =
  process.platform === "win32" && socketPath ? `\\\\.\\pipe\\${socketPath}` : socketPath;
const paneId = process.env.HERDR_PANE_ID;
const source = "herdr:dsh";
const agent = "dsh";

/** 轮询编辑器座位占用态的间隔（毫秒）。 */
const BLOCKED_POLL_MS = 700;

function enabled() {
  return (
    HERDR_ENV === "1" && socketPath != null && socketPath !== "" && paneId != null && paneId !== ""
  );
}

function sendRequestAttempt(request, timeoutMs) {
  if (!enabled()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (delivered) => {
      if (done) return;
      done = true;
      if (timeout) clearTimeout(timeout);
      socket.destroy();
      resolve(delivered);
    };
    const socket = net.createConnection(socketEndpoint);
    socket.on("error", () => finish(false));
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", () => finish(true));
    socket.on("end", () => finish(false));
    const timeout = setTimeout(() => finish(false), timeoutMs);
    timeout.unref?.();
  });
}

async function sendRequest(request) {
  if (await sendRequestAttempt(request, 500)) return;
  await sendRequestAttempt(request, 1500);
}

let reportSeq = Date.now() * 1000;
function nextReportSeq() {
  reportSeq += 1;
  return reportSeq;
}

/** 当前会话引用（herdr 用它把状态挂到 agent 会话上）。 */
let sessionRef = undefined;

function withSessionRef(params) {
  return sessionRef ? { ...params, ...sessionRef } : params;
}

function reportSession() {
  if (!sessionRef) return Promise.resolve();
  return sendRequest({
    id: `${source}:session:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    method: "pane.report_agent_session",
    params: {
      pane_id: paneId,
      source,
      agent,
      seq: nextReportSeq(),
      ...sessionRef,
    },
  });
}

function sendState(state, message, seq = nextReportSeq()) {
  return sendRequest({
    id: `${source}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    method: "pane.report_agent",
    params: withSessionRef({
      pane_id: paneId,
      source,
      agent,
      state,
      message,
      seq,
    }),
  });
}

let sendInFlight = false;
let queuedState = undefined;

function queueState(state, message) {
  queuedState = { state, message, seq: nextReportSeq() };
  if (!sendInFlight) void drainStateQueue();
}

async function drainStateQueue() {
  if (sendInFlight) return;
  sendInFlight = true;
  try {
    while (queuedState) {
      const next = queuedState;
      queuedState = undefined;
      await sendState(next.state, next.message, next.seq);
    }
  } finally {
    sendInFlight = false;
    if (queuedState) void drainStateQueue();
  }
}

export const name = "dsh-herdr-state";
export const inject = ["tuiStartup", "piTuiExtensions"];

export function apply(ctx) {
  if (!enabled()) return;
  const service = ctx.get("piTuiExtensions");
  if (!service?.subscribeState) return;

  let working = false;
  let blocked = false;
  let lastState;
  let lastMessage;
  let pollTimer;

  // Advanced editor seam（editor 座位占用轮询）。这是 dsh-pi-tui advanced
  // facade（advanced(service).editor.getEditorState）背后的同一 seam；为免去
  // profile 内对上游包的依赖解析，直接按签名调用并以 typeof 特性检测兜底。
  // seam 缺失或改名时 blocked 恒为 false，working/idle 上报不受影响。
  let editorComposing = undefined;
  if (typeof service._advancedEditorControls === "function") {
    try {
      const controls = service._advancedEditorControls();
      if (typeof controls?.getEditorState === "function") {
        editorComposing = () => controls.getEditorState().composing === true;
      }
    } catch {
      editorComposing = undefined;
    }
  }

  function desiredState() {
    if (blocked) return { state: "blocked", message: "等待用户确认（审批或问卷）" };
    if (working) return { state: "working", message: undefined };
    return { state: "idle", message: undefined };
  }

  function publishState() {
    const next = desiredState();
    if (next.state === lastState && next.message === lastMessage) return;
    lastState = next.state;
    lastMessage = next.message;
    queueState(next.state, next.message);
  }

  service.subscribeState((snapshot) => {
    const session = snapshot.session;
    if (session?.sessionId && !sessionRef) {
      sessionRef = { agent_session_id: session.sessionId };
      void reportSession();
    }
    working = Boolean(session?.busy) || Boolean(snapshot.activity?.working);
    publishState();
  });

  if (editorComposing) {
    pollTimer = setInterval(() => {
      let composing = false;
      try {
        composing = editorComposing();
      } catch {
        composing = false;
      }
      if (composing !== blocked) {
        blocked = composing;
        publishState();
      }
    }, BLOCKED_POLL_MS);
    pollTimer.unref?.();
  }

  ctx.on("dispose", () => {
    if (pollTimer) clearInterval(pollTimer);
  });
}
