/**
 * 把阻塞态对话框翻译成 herdr 的 blocked 上报（herdr-blocked 包）
 *
 * 根因：herdr 官方 pi 集成（~/.pi/agent/extensions/herdr-agent-state.ts，herdr
 * 托管禁改）经 socket 上报 working/idle/blocked 三态，其中 blocked 只由共享总线
 * 上的 `herdr:blocked` 事件驱动（payload 为 { active, label }），但 pi 侧没有任何
 * 内置来源 emit 它——ask-user-question 弹窗等人时 herdr 侧栏停留在 working，即此
 * 缺口。pi 原生的 OSC 7501 程序状态协议（blocked 语义相同）herdr 0.9.1 不解析，
 * 无法借用。
 *
 * 做法：监听 `ui_prompt_start`/`ui_prompt_end`（pi runner 对全部阻塞式扩展 UI
 * 对话框的生命周期包装，select/confirm/input/editor/custom 五类，错误路径由
 * runner finally 兜底），换算成 herdr:blocked：
 * - start：depth +1，emit { active: true, label }
 * - end：depth 清零才 emit { active: false }（嵌套对话框不早释）
 * label 取事件 title；问卷弹窗（ctx.ui.custom 调用未传 title）回退到
 * rpiv:ask-user:prompt（ask-user-question 开窗前广播的问题清单）的首条问题文本，
 * 每次 start 消费一次，end 清底，避免陈旧 hint 贴到无关对话框。
 *
 * 契约：herdr:blocked 的消费方是官方桥接（blockedCount 计数，本包保证 start/end
 * 配对即可）；rpiv:ask-user:prompt 字段为 { questions, toolCallId }，事件名以
 * 字符串常量对齐 vendor 包（各包自包含，不跨包 import）。
 *
 * 门控：HERDR_ENV + HERDR_SOCKET_PATH + HERDR_PANE_ID 三者齐全（与官方桥接同款
 * 判断），herdr 之外零行为。非 tui 模式（RPC/print）不再重复设闸：消费方桥接
 * 自带 ctx.mode 门，那里 emit 出去也无人消费；且 session_start 时序上轮不到本
 * 包先标记，设闸反而会吞掉 session_start 内开窗的 ui_prompt（实测踩中）。
 *
 * 边界：reload 或崩溃发生在弹窗中时 end 事件丢失，herdr 停在 blocked——官方桥接
 * reload 时 session_start 强制重发会重置自身计数，本包新实例 depth 从零起，两边
 * 一致收敛，无恶化。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const HERDR_BLOCKED_EVENT = "herdr:blocked";
const ASK_USER_PROMPT_EVENT = "rpiv:ask-user:prompt";
const LABEL_MAX = 60;

interface AskUserPromptPayload {
  questions?: readonly { question?: string }[];
}

function herdrEnvActive(): boolean {
  const { env } = process;
  return (
    env["HERDR_ENV"] === "1" && Boolean(env["HERDR_SOCKET_PATH"]) && Boolean(env["HERDR_PANE_ID"])
  );
}

export default function (pi: ExtensionAPI) {
  if (!herdrEnvActive()) {
    return;
  }

  let depth = 0;
  let questionHint: string | undefined;

  pi.events.on(ASK_USER_PROMPT_EVENT, (data) => {
    const { questions } = data as AskUserPromptPayload;
    const first = questions?.[0];
    questionHint = first?.question;
  });

  pi.on("ui_prompt_start", (event) => {
    depth += 1;
    const raw = event.title ?? questionHint ?? `对话框（${event.kind}）`;
    questionHint = undefined;
    const label = raw.length > LABEL_MAX ? `${raw.slice(0, LABEL_MAX)}…` : raw;
    pi.events.emit(HERDR_BLOCKED_EVENT, { active: true, label });
  });

  pi.on("ui_prompt_end", () => {
    questionHint = undefined;
    if (depth > 0) {
      depth -= 1;
    }
    if (depth === 0) {
      pi.events.emit(HERDR_BLOCKED_EVENT, { active: false });
    }
  });
}
