/**
 * 流式输出速度采集与计算（statusline 专用纯库）。
 *
 * 数据源：扩展事件流（index.ts 接线）
 *   message_start(assistant) → 回合开始计时
 *   message_update 的 text_delta/thinking_delta → 字符增量入滑动窗口
 *   message_end(assistant) → 以精确 usage.output 校准回合平均并保留
 *
 * 口径（经确认）：
 *   平均 = 当前回合输出 tokens ÷ 流式耗时；流式中以 delta 估算实时呈现，
 *   结束时以精确值校准并保留（空闲时仍显示最近一回合的值）
 *   最近 1s = text+thinking 增量的 1s 滑动窗口；仅流式中有效
 *
 * token 估算：流式 delta 无精确 token 数，按 CJK 每字 1 token、其余每
 * 4 字符 1 token 估算（thinking-flow 同款公式，家规"自备副本"）。
 */

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

/** CJK 每字 1 token、其余每 4 字符 1 token（量级指示，非精确值） */
function estimateTokens(text: string): number {
  const cjk = text.match(CJK_RE)?.length ?? 0;
  return Math.ceil(cjk + (text.length - cjk) / 4);
}

export interface SpeedSnapshot {
  /** 平均 tok/s：流式中为实时估算，空闲后为最近回合精确值；无数据为 null */
  avgTokPerSec: number | null;
  /** 最近 1s tok/s：仅流式中有效，其余为 null */
  recentTokPerSec: number | null;
  streaming: boolean;
}

interface WindowSample {
  t: number;
  tokens: number;
}

const WINDOW_MS = 1000;
/** 回合最短分母：首帧即算速度时分母过小导致数值爆炸，钳到 0.5s */
const MIN_ELAPSED_S = 0.5;

export interface StreamSpeed {
  onAssistantStart: () => void;
  onDelta: (text: string) => void;
  /** 以消息的精确 output tokens 校准回合平均；usage 缺失时保留估算 */
  onAssistantDone: (exactOutput: number | undefined) => void;
  snapshot: (now?: number) => SpeedSnapshot;
}

export function createStreamSpeed(): StreamSpeed {
  let turnStart = 0;
  let turnTokens = 0;
  let window: WindowSample[] = [];
  let streaming = false;
  // 空闲保留值：最近回合的精确（或估算兜底）平均
  let lastAvg: number | null = null;
  let lastElapsedMs = 0;

  const pruneWindow = (now: number): void => {
    const cutoff = now - WINDOW_MS;
    while (window.length > 0 && (window[0]?.t ?? 0) < cutoff) {
      window.shift();
    }
  };

  return {
    onAssistantStart() {
      turnStart = Date.now();
      turnTokens = 0;
      window = [];
      lastElapsedMs = 0;
      streaming = true;
    },
    onDelta(text) {
      if (!streaming || text.length === 0) {
        return;
      }
      const now = Date.now();
      const tokens = estimateTokens(text);
      turnTokens += tokens;
      window.push({ t: now, tokens });
      pruneWindow(now);
    },
    onAssistantDone(exactOutput) {
      if (!streaming) {
        return;
      }
      lastElapsedMs = Math.max(1, Date.now() - turnStart);
      const elapsedS = lastElapsedMs / 1000;
      lastAvg = (exactOutput ?? turnTokens) / elapsedS;
      streaming = false;
      window = [];
    },
    snapshot(now = Date.now()): SpeedSnapshot {
      if (streaming && turnStart > 0) {
        const elapsedS = Math.max(MIN_ELAPSED_S, (now - turnStart) / 1000);
        pruneWindow(now);
        const recentTokens = window.reduce((sum, s) => sum + s.tokens, 0);
        return {
          avgTokPerSec: turnTokens / elapsedS,
          recentTokPerSec: recentTokens / (WINDOW_MS / 1000),
          streaming: true,
        };
      }
      if (lastAvg !== null && lastElapsedMs > 0) {
        // 完成时已按精确值（或估算兜底）算好保留值，直接呈现
        return { avgTokPerSec: lastAvg, recentTokPerSec: null, streaming: false };
      }
      return { avgTokPerSec: null, recentTokPerSec: null, streaming: false };
    },
  };
}

/** 速度段文案："平均 12.3 · 1s 45.6 tok/s"；仅平均时省略 1s 段 */
export function formatSpeedText(snapshot: SpeedSnapshot): string | undefined {
  const { avgTokPerSec, recentTokPerSec } = snapshot;
  if (avgTokPerSec === null) {
    return undefined;
  }
  const avg = avgTokPerSec.toFixed(1);
  if (recentTokPerSec === null) {
    return `平均 ${avg} tok/s`;
  }
  return `平均 ${avg} · 1s ${recentTokPerSec.toFixed(1)} tok/s`;
}

export { estimateTokens };
