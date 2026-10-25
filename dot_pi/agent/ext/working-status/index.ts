/**
 * Working 状态扩展（working-status）
 *
 * 目标：把 pi 流式期间的 Working 指示行从静态 "Working" 改为随 agent
 * 生命周期切换的中文状态文案，全状态带持续计时（转圈动画帧沿用内置
 * 默认，不附中断键提示），状态样例：
 *   准备请求（1s） / 发送请求 36 KB（2s） / 等待模型响应（8s） /
 *   生成中（12s） / 执行工具 bash（2s）
 *
 * 状态机（事件驱动，文案相同不重复设置）：
 *   before_agent_start                       → 重试计数清零（仅真实新 run 触发）
 *   agent_start                              → 准备请求（run 启动与组装并入）
 *   before_provider_request                  → 发送请求 <大小>（连接+上传中；失败过则附重试序号）
 *   undici bodySent（发送窗口内首个命中）    → 等待模型响应（上传完成，排队+prefill+首字节）
 *   after_provider_response                  → 解除发送窗口；bodySent 未命中时兜底切等待模型响应
 *   message_start（assistant 且非 error）    → 重试计数清零（不切状态）
 *   首个 provider_stream_event               → 生成中（服务器真正开始输出）
 *   message_end（assistant stopReason=error）→ 重试计数 +1，不切状态
 *   tool_execution_start                     → 执行工具 <toolName>
 *   tool_execution_end                       → 嵌套调用回退父工具名，顶层保持
 *   agent_end                                → 复位为内置默认文案
 *
 * 计时：每次状态切换重置秒表，显示当前状态已进入的第 N 秒（N = 已过
 * 整秒数 + 1）：t=0 即第 1 秒，t=1s 的 tick 直接进位到 2s，避免（0s）
 * 且不落后。旧实现用 floor 最低 1s，把 0-1 秒折叠进 1s，1s 要顶两拍、
 * 整条秒表恒定落后一拍。interval 每秒刷新且每次切换重建（tick 落在
 * since+k 秒整点）；秒表仅状态活跃时运行。
 *
 * 请求段三段切分的机制事实（pi 1.4.0 源码 + node 26 undici 本地实测）：
 * - 扩展事件面只有三刀：before_provider_request（发出前）、
 *   after_provider_response（响应头到达，仅 2xx）、provider_stream_event
 *   （每个原始 SSE 事件）；连接与上传过程没有任何钩子——请求体交给
 *   官方 SDK 内部的 fetch，promise 在响应头到达时才 resolve，上传进度
 *   对 JS 层不可见
 * - 三个 API 适配器同构（anthropic-messages / openai-completions /
 *   openai-responses）：onPayload → SDK create().asResponse() →
 *   onResponse 与 stream.push(start) 背靠背 → SSE 循环；assistant 的
 *   message_start 实为响应头时刻，不等首个内容 token——旧版"生成中"
 *   从响应头就亮，把等首 token 的时间也计了进去
 * - undici diagnostics_channel 的 undici:request:bodySent 在请求体写完
 *   时发布（1MB 本地实测：bodySent +87ms、服务端收全 +98ms、响应头
 *   +3146ms），是事件面外唯一可用的"上传完成"信号；据此把发送段切成
 *   上传中/等待响应 两段
 * - “生成中”起点后移到首个 provider_stream_event：响应头到首 SSE 事件
 *   之间的真实等待（OpenAI 官方风格先回 200 头再憋首 chunk）不再计入
 *   生成
 * - 事件到达顺序实测：message_start 可能晚于首个 provider_stream_event
 *   （Agent 消费 pi-ai start 队列与适配器直调 onProviderStreamEvent 走
 *   不同通道），故降级兜底（bodySent 未命中时切等待）挂
 *   after_provider_response——它在适配器内直调分发，恒早于 SSE 循环的
 *   首事件；message_start 不切状态，避免把生成中打回等待
 *
 * 实测事实（pi 1.4.0，tmux 捕帧 + 本地 500/SSE 服务器）：
 * - after_provider_response 仅在响应成功到达时触发；500 等错误路径不触发，
 *   错误以 stopReason="error" + errorMessage 的合成 assistant 消息送达
 *   （message_start/message_end 均携带）——重试计数挂 message_end，
 *   顺带覆盖流中途出错（message_start 时 stopReason 还是 pending）的情形
 *   （源码依据：SDK 对非 2xx 抛 APIError，pi-ai 的 retryProviderRequest
 *   内部退避重试 408/409/429/5xx，整个重试循环零事件）
 * - 重试退避窗口（Retrying (1/3) in 2s...）由内置指示器整体接管，
 *   本扩展文案被替换；重试序号改挂在下一次请求的文案上可见
 * - provider 层重试表现为 agent_end → agent_start 的新 agent run
 *   （turnIndex 重置为 0，无 before_agent_start）——计数清零挂
 *   before_agent_start，跨重试 run 延续
 * - 请求 payload 为对象，大小按 JSON 序列化字节数估算（KB 向上取整）
 * - ui_prompt_start/end 与“等待确认”态经实测放弃：阻塞式对话框会整块
 *   替换指示行所在区域（文本不可能可见），且 pi 默认不对工具调用弹审批
 *   （security.md），预期的触发面不存在——工具卡死与用户操作的区分
 *   改由对话框自身可见性承担
 *
 * 设计说明：
 * - bodySent 关联用发送窗口内首个命中，不按 path 过滤：扩展拿不到
 *   baseUrl，且窗口内并发的上传基本只有主请求与 cacheWarmer 预热请求
 *   （同前缀同模型，bodySent 先后差亚秒级，语义同为"上传完成"）；
 *   cacheWarming 默认 streaming 开启且完整复用扩展事件链，主/暖请求
 *   在扩展事件面不可区分——这是旧版 message_start 起点就存在的污染，
 *   新方案未引入新类型
 * - 降级路径：无 node:diagnostics_channel（bun binary 发行形态）或
 *   channel 名失效时 bodySent 永不命中，状态停在发送请求直到
 *   message_start 兜底切等待模型响应，行为近似旧版且分段仍比旧版准；
 *   bedrock 走 AWS SDK 不经 undici，同样走兜底。mihomo TUN 下 bodySent
 *   只代表写入 TUN 设备完成（严格意义偏早），上行饱和时内核反压会让
 *   它真实推迟，方向仍正确
 * - dc listener 异常会同步传播进 fetch 调用栈：回调整体 try/catch
 *   吞掉，观测不得影响请求；订阅挂 globalThis 槽，reload 先 dispose
 *   旧订阅（与 timer 同款幂等）
 * - 工具计时按调用者计：start 记录各 callId 真实起点，显示谁用谁的起点
 *   ——嵌套子工具用子起点，回退父工具恢复父真实耗时；相邻同名调用
 *   callId 不同，计时各自重置（旧实现按文案判重会跨调用累加）
 * - 等待确认态已实测放弃（见实测事实节），无需处理 ui_prompt；
 * - retry / compaction / branchSummary 阶段由内置指示器整体接管，
 *   本扩展不干预；agent_end 复位保证下一轮干净
 * - message_start 对 user/toolResult 消息也触发，仅 assistant 处理；
 *   message_update 不监听（生成中逐 delta 重设无意义）
 * - codemode 嵌套工具调用（parentToolCallId 存在）结束后回退显示父工具，
 *   避免状态闪成嵌套工具名后回不去
 * - setWorkingMessage 不带参数即恢复内置默认；文案变化才调用，
 *   避免逐 delta 触发无谓重渲染
 * - 秒表 timer 与 dc 订阅存 globalThis 槽，重装先清旧（reload 幂等，
 *   旧闭包不得残留 stale ctx 调用）
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const PREPARING = "准备请求";
const WAITING = "等待模型响应";
const GENERATING = "生成中";
const TICK_MS = 1000;
const KB = 1024;
const MB = KB * 1024;

const TIMER_KEY = Symbol.for("pi-meow-working-status:timer");
const DC_KEY = Symbol.for("pi-meow-working-status:dc");

const fmtSize = (bytes: number): string =>
  bytes < MB ? `${Math.ceil(bytes / KB)} KB` : `${(bytes / MB).toFixed(1)} MB`;

const payloadSize = (payload: unknown): number => {
  try {
    if (typeof payload === "string") {
      return payload.length;
    }
    if (payload !== null && typeof payload === "object") {
      return JSON.stringify(payload).length;
    }
  } catch {
    // 序列化失败按无大小处理
  }
  return 0;
};

interface Ticker {
  show: (ctx: ExtensionContext, base: string, clockStart?: number) => void;
  clear: (ctx: ExtensionContext) => void;
}

const createTicker = (): Ticker => {
  let current: string | undefined;
  let since = 0;
  let lastCtx: ExtensionContext | undefined;

  // 当前处于第 N 秒：已过整秒数 + 1。floor 语义会把 0-1 秒折叠进 1s
  // （最低 1s 兜底），使 1s 持续两拍、整条秒表落后一拍
  const label = (base: string): string =>
    `${base}（${Math.floor((Date.now() - since) / TICK_MS) + 1}s）`;

  const stopTimer = (): void => {
    const globals = globalThis as unknown as Record<symbol, unknown>;
    const timer = globals[TIMER_KEY] as ReturnType<typeof setInterval> | undefined;
    if (timer !== undefined) {
      clearInterval(timer);
      delete globals[TIMER_KEY];
    }
  };

  const ensureTimer = (): void => {
    const globals = globalThis as unknown as Record<symbol, unknown>;
    if (globals[TIMER_KEY] !== undefined) {
      return;
    }
    globals[TIMER_KEY] = setInterval(() => {
      if (current === undefined || lastCtx === undefined) {
        return;
      }
      lastCtx.ui.setWorkingMessage(label(current));
    }, TICK_MS);
  };

  return {
    show: (ctx, base, clockStart) => {
      if (current === base) {
        return;
      }
      current = base;
      since = clockStart ?? Date.now();
      lastCtx = ctx;
      stopTimer();
      ctx.ui.setWorkingMessage(label(base));
      ensureTimer();
    },
    clear: (ctx) => {
      stopTimer();
      if (current === undefined) {
        return;
      }
      current = undefined;
      since = 0;
      ctx.ui.setWorkingMessage();
    },
  };
};

interface DcSubscription {
  dispose: () => void;
}

/**
 * 订阅 undici 请求体发送完成事件（undici:request:bodySent）。
 *
 * channel 名是 undici 内部约定而非公共契约（Node 内置多年未变，仍按
 * 会失效处理）；非 node 运行时或模块缺失时静默放弃，状态机走 message_start
 * 兜底切分。listener 异常会同步传播进 fetch 调用栈，回调必须整体吞掉
 * ——指示行状态错误不得影响请求本身。
 */
const subscribeRequestBodySent = (onBodySent: () => void): void => {
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const previous = globals[DC_KEY] as DcSubscription | undefined;
  previous?.dispose();
  delete globals[DC_KEY];
  void (async () => {
    try {
      const { subscribe, unsubscribe } = await import("node:diagnostics_channel");
      const handler = (): void => {
        try {
          onBodySent();
        } catch {
          // 观测失败静默：不影响请求路径
        }
      };
      subscribe("undici:request:bodySent", handler);
      globals[DC_KEY] = {
        dispose: () => {
          try {
            unsubscribe("undici:request:bodySent", handler);
          } catch {
            // 旧运行时通道已失效则忽略
          }
        },
      };
    } catch {
      // 无 node:diagnostics_channel（如 bun binary）：降级运行
    }
  })();
};

export default function workingStatus(pi: ExtensionAPI): void {
  const ticker = createTicker();
  const names = new Map<string, string>();
  const starts = new Map<string, number>();
  let failedAttempts = 0;
  let latestCtx: ExtensionContext | undefined;
  // 发送窗口：before_provider_request 武装，bodySent 首个命中即解除；
  // 响应头兜底（message_start 处）与 agent_end 兜底解除，防窗口跨请求残留
  let uploadArmed = false;
  // 当前请求是否已见首个 provider SSE 事件——“生成中”的真实起点，
  // 每次新请求（before_provider_request）重置
  let streamSeen = false;

  subscribeRequestBodySent(() => {
    if (!uploadArmed || latestCtx === undefined) {
      return;
    }
    uploadArmed = false;
    ticker.show(latestCtx, WAITING);
  });

  pi.on("before_agent_start", (_event, _ctx) => {
    // 仅真实新 run（用户提示/自定义消息）清零。Provider 层重试走的
    // 是 agent_end → agent_start 的新 agent run，不触发本事件，计数延续
    failedAttempts = 0;
  });
  pi.on("agent_start", (_event, ctx) => {
    ticker.show(ctx, PREPARING);
  });
  pi.on("before_provider_request", (event, ctx) => {
    latestCtx = ctx;
    uploadArmed = true;
    streamSeen = false;
    const bytes = payloadSize(event.payload);
    const size = bytes > 0 ? ` ${fmtSize(bytes)}` : "";
    const retry = failedAttempts > 0 ? ` · 重试${failedAttempts}` : "";
    ticker.show(ctx, `发送请求${size}${retry}`);
  });
  pi.on("provider_stream_event", (_event, ctx) => {
    if (streamSeen) {
      return;
    }
    streamSeen = true;
    ticker.show(ctx, GENERATING);
  });
  pi.on("after_provider_response", (_event, ctx) => {
    // 响应头已到（直调分发，恒早于 SSE 首事件）：解除发送窗口；降级兜底切等待
    uploadArmed = false;
    if (!streamSeen) {
      ticker.show(ctx, WAITING);
    }
  });
  pi.on("message_start", (event) => {
    if (event.message.role !== "assistant") {
      return;
    }
    const { stopReason } = event.message as { stopReason?: string };
    if (stopReason === "error") {
      return;
    }
    // 只清零不切状态：本事件经 Agent 队列分发，实测可能晚于首个流事件
    failedAttempts = 0;
  });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") {
      return;
    }
    const { stopReason } = event.message as { stopReason?: string };
    if (stopReason === "error") {
      failedAttempts += 1;
    }
  });
  pi.on("tool_execution_start", (event, ctx) => {
    names.set(event.toolCallId, event.toolName);
    starts.set(event.toolCallId, Date.now());
    ticker.show(ctx, `执行工具 ${event.toolName}`, starts.get(event.toolCallId));
  });
  pi.on("tool_execution_end", (event, ctx) => {
    starts.delete(event.toolCallId);
    names.delete(event.toolCallId);
    const parentId = event.parentToolCallId;
    if (parentId === undefined) {
      return;
    }
    const parentName = names.get(parentId);
    if (parentName !== undefined) {
      ticker.show(ctx, `执行工具 ${parentName}`, starts.get(parentId));
    }
  });
  pi.on("agent_end", (_event, ctx) => {
    // 重试紧随 agent_end 而来，此处清零计数会让下一次请求丢掉重试序号；
    // 计数清零只挂 before_agent_start
    names.clear();
    starts.clear();
    uploadArmed = false;
    streamSeen = false;
    ticker.clear(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => ticker.clear(ctx));
}
