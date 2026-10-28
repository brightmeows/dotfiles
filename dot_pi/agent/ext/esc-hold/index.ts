/**
 * Esc 防误触扩展（esc-hold）
 *
 * 目标：防止误触 Esc 打断对话——单击 Esc 只显示提示不中断，
 * 双击（或长按）才放行。空闲时完全放行，pi 原生行为原样保留
 * （双击开对话树、Esc 关闭选择器、取消 autocomplete 等）。
 *
 * 行为（pi ≥1.2 起 run 启动窗口期——含 before_agent_start 处理器执行期
 * ——即算 busy，isIdle() 提前翻 false）：
 *
 * ┌ 运行中（ctx.isIdle() === false）
 * │  release（松开）一律吞掉——松开动作永远不能触发中断或取消
 * │  run 态（没有阻塞式扩展对话框）
 * │    单击（press → release）：吞掉（consume），不中断，
 * │      底部提示“双击 Esc 中断对话…”（1.5s 自动消失）
 * │    双击（800ms 内第二下 press）：放行给内置处理
 * │      → 流式中断 run；重试/压缩取消对应操作
 * │    长按（repeat 事件 / 传统终端重复字节）：同样放行（宽容）
 * │    一次按住周期内只放行一次，防止长按期间 repeat 连发重复触发
 * │  prompt 态（运行中出现阻塞式扩展对话框，ui_prompt_start/end 配对）
 * │    单击：吞掉，底部提示“双击 Esc 取消对话框…”
 * │    双击/长按：放行给对话框自身处理
 * │      → 问卷取消提问（tool 返回 cancelled，run 继续），其他对话框同理
 * ├ 空闲时（ctx.isIdle() === true）
 * │  全部放行：双击开对话树、Esc 关闭选择器、取消 autocomplete、
 * │  空闲期打开的对话框（/model 等）均为 pi 原生行为，本扩展不干预
 * └ 场景切换（空闲↔运行、run↔prompt）时重置按键周期
 *
 * 提示：ctx.ui.setStatus() 显示在底部状态栏（与 git 分支等扩展状态同区），
 * 1.5s 自动清除。
 *
 * 设计权衡：
 * - 拦截范围（2026-10-28 主人确认）：整个运行期都守（含等待模型、工具
 *   执行、自动重试、自动压缩），空闲全放行；运行中所有阻塞式扩展对话框
 *   进入 prompt 态，单击同样吞掉，但提示与双击目标改为“取消对话框”。
 * - prompt 态双击交给对话框原生取消（2026-10-28 确认）：问卷取消提问、
 *   run 继续，与 pi 原生 Esc 语义一致，不由扩展 abort run。
 * - 提示两分（2026-10-28 确认）：run 态“双击 Esc 中断对话…”，prompt 态
 *   “双击 Esc 取消对话框…”。
 * - 双击与长按都放行（2026-08-05 主人确认；宽容处理：长按的 repeat 也
 *   落在 800ms 窗口内）
 * - 双击判定窗口 800ms：覆盖双击手速（100–300ms）与常见系统 repeat
 *   delay（250–500ms）；间隔超过 800ms 的两次单击视为独立单击
 * - 支持 Kitty 键盘协议（pi 启动时自动查询启用）时按 repeat/release 事件
 *   精确区分长按与松开；alacritty 0.13+ / kitty / wezterm 等均支持
 * - 传统终端（无 Kitty 协议）只有裸 ESC 字节、无 release 事件：
 *   单击/双击按间隔判定可用，但长按超 800ms 后可能再次放行
 *   （松开无法感知）；个别把 repeat delay 配到 1s 以上时长按不生效
 * - 中断后仍按住（运行中→空闲转换）：剩余按住事件继续吞掉，
 *   不会误触发空闲双击开树
 *
 * 实现说明：
 * - ctx.ui.onTerminalInput() 是 TUI 全局输入钩子（任何组件处理按键之前），
 *   返回 { consume: true } 吞掉按键，返回 undefined 放行
 * - 场景判定：按键时取 ctx.isIdle()；非空闲时再看 ui_prompt_start/end
 *   维护的对话框标记（runner 只对最外层阻塞 UI 发 start/end，布尔即可）
 * - 状态机为纯函数 handleEscEvent()，便于单元测试
 * - 会话切换（/new、/tree 切换、reload）时重新注册监听器并重置状态
 *
 * 目录组织（2026-08-30 拆包）：由 input/ 拆出独立成包（一包一扩展），
 * 本文件改名 index.ts 直接作为包入口。
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, isKeyRelease, isKeyRepeat } from "@earendil-works/pi-tui";

/** Footer 状态栏提示用的唯一 key（setStatus） */
const HINT_KEY = "esc-hold";
/** 提示显示时长 */
const HINT_DURATION_MS = 1500;
/** 双击/长按判定窗口：覆盖双击手速与常见系统 repeat delay */
const SECOND_PRESS_WINDOW_MS = 800;
/** 传统模式下视为"仍在按住"的密集重复字节间隔 */
const REPEAT_GAP_MS = 120;

/** 按键时判定的场景：空闲 / 运行中无对话框 / 运行中有对话框 */
export type EscHoldMode = "idle" | "run" | "prompt";

export interface EscHoldState {
  /** 当前周期所属场景（跨场景转换时重置按键周期） */
  phase: EscHoldMode;
  /** 本周期内被吞掉的第一下按下时间（0 = 无） */
  firstPressAt: number;
  /** 本周期已放行的时间（0 = 未放行），放行后窗口内的事件全部吞掉 */
  actedAt: number;
  /** 上一次 Esc 事件时间（传统模式判断密集重复用） */
  lastEscAt: number;
}

export type EscHoldAction =
  | { type: "consume" } // 吞掉，不触发任何动作
  | { type: "pass" } // 放行给内置处理
  | { type: "hint"; mode: "run" | "prompt" }; // 吞掉 + 按场景提示

export function createEscHoldState(): EscHoldState {
  return { phase: "idle", firstPressAt: 0, actedAt: 0, lastEscAt: 0 };
}

export interface EscHoldInput {
  /** Kitty 协议的 repeat 事件（长按中） */
  isRepeat: boolean;
  /** Kitty 协议的 release 事件（松开） */
  isRelease: boolean;
  /** 事件时间戳 */
  now: number;
  /** 按键时的场景（prompt 仅在运行中且对话框打开时出现） */
  mode: EscHoldMode;
}

/**
 * Esc 事件判定（纯函数，原地更新 state）。
 *
 * 事件已由调用方确认是 Esc（press / repeat / release / 传统裸字节）。
 */
export function handleEscEvent(state: EscHoldState, input: EscHoldInput): EscHoldAction {
  const prevEscAt = state.lastEscAt;
  state.lastEscAt = input.now;

  // ---- 空闲：完全放行（pi 原生行为：双击开树、关选择器、取消补全等） ----
  if (input.mode === "idle") {
    state.phase = "idle";
    if (state.actedAt !== 0) {
      if (input.isRelease) {
        // 松开（中断后仍按住的周期结束）：重置
        state.actedAt = 0;
        state.firstPressAt = 0;
        return { type: "pass" };
      }
      // 运行中放行后转换而来：按住剩余事件吞掉，防中断后误触发空闲双击开树
      if (input.now - state.actedAt < SECOND_PRESS_WINDOW_MS) {
        return { type: "consume" };
      }
      state.actedAt = 0;
      state.firstPressAt = 0;
    }
    state.firstPressAt = 0;
    return { type: "pass" };
  }

  // ---- 运行中：run（无对话框）/ prompt（有阻塞对话框） ----
  if (state.phase !== input.mode) {
    // 跨场景（空闲到运行、run 与 prompt 互转）：上一场景的按键周期作废
    state.phase = input.mode;
    state.firstPressAt = 0;
    state.actedAt = 0;
  }
  if (input.isRelease) {
    // 松开：吞掉（松开永远不能触发中断）。
    // 长按周期结束则重置；单击/双击间隙保留 firstPressAt，让双击第二下仍能判定
    if (state.actedAt !== 0) {
      state.actedAt = 0;
      state.firstPressAt = 0;
    }
    return { type: "consume" };
  }
  if (state.actedAt !== 0) {
    // 本周期已放行过：窗口内吞掉（防长按 repeat 连发），窗口过后视为新周期
    if (input.isRepeat) {
      // Kitty repeat = 仍在按住：无论冷却是否过期都吞（松开以 release 事件为准）
      return { type: "consume" };
    }
    if (input.now - state.actedAt < SECOND_PRESS_WINDOW_MS) {
      return { type: "consume" };
    }
    if (input.now - prevEscAt < REPEAT_GAP_MS) {
      // 传统模式密集重复（按住中）→ 冷却顺延
      state.actedAt = input.now;
      return { type: "consume" };
    }
    // 冷却已过且非密集：周期结束，重新判定
    state.actedAt = 0;
    state.firstPressAt = 0;
  }
  if (state.firstPressAt !== 0 && input.now - state.firstPressAt < SECOND_PRESS_WINDOW_MS) {
    // 第二下（双击第二下 / 长按 repeat）→ 放行 → 内置中断或对话框取消
    state.actedAt = input.now;
    return { type: "pass" };
  }
  // 第一下：吞掉 + 提示
  state.firstPressAt = input.now;
  return { type: "hint", mode: input.mode };
}

export default function (pi: ExtensionAPI) {
  // 当前会话上下文（session_start 时更新）
  let currentCtx: ExtensionContext | null = null;
  let unsubscribe: (() => void) | undefined;
  // 运行中的阻塞式扩展对话框（ui_prompt_start/end 配对）
  let promptActive = false;
  // 提示定时器
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  const state = createEscHoldState();

  const showHint = (text: string) => {
    currentCtx?.ui.setStatus(HINT_KEY, text);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      currentCtx?.ui.setStatus(HINT_KEY, undefined);
    }, HINT_DURATION_MS);
  };

  const resetState = () => {
    clearTimeout(hintTimer);
    currentCtx?.ui.setStatus(HINT_KEY, undefined);
    Object.assign(state, createEscHoldState());
  };

  const handler = (data: string): { consume?: boolean; data?: string } | undefined => {
    const ctx = currentCtx;
    if (!ctx || !matchesKey(data, "escape")) {
      return undefined;
    }
    let mode: EscHoldMode = "run";
    if (ctx.isIdle()) {
      mode = "idle";
    } else if (promptActive) {
      mode = "prompt";
    }
    const action = handleEscEvent(state, {
      isRepeat: isKeyRepeat(data),
      isRelease: isKeyRelease(data),
      now: Date.now(),
      mode,
    });
    switch (action.type) {
      case "consume": {
        return { consume: true };
      }
      case "pass": {
        return undefined;
      }
      case "hint": {
        showHint(action.mode === "prompt" ? "双击 Esc 取消对话框…" : "双击 Esc 中断对话…");
        return { consume: true };
      }
    }
  };

  pi.on("session_start", (_event, ctx) => {
    currentCtx = ctx;
    promptActive = false;
    resetState();
    // 会话切换时先注销旧监听，避免重复注册
    unsubscribe?.();
    unsubscribe = ctx.ui.onTerminalInput?.(handler);
  });

  pi.on("ui_prompt_start", () => {
    promptActive = true;
  });

  pi.on("ui_prompt_end", () => {
    promptActive = false;
  });

  pi.on("session_shutdown", () => {
    unsubscribe?.();
    unsubscribe = undefined;
    currentCtx = null;
    promptActive = false;
    clearTimeout(hintTimer);
  });
}
