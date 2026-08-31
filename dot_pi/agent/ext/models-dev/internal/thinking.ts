/**
 * 思考挡位映射（thinking 子模块）
 *
 * 将 models.dev 的 reasoning_options.effort 挡位列表映射为 pi 的
 * thinkingLevelMap（pi 层级含 max，见 docs/models.md"Keys are pi thinking
 * levels: off, minimal, low, medium, high, xhigh, max"）。纯函数，便于单测。
 *
 * 映射规则：
 * - off      → "none"（仅 provider 显式列出时；否则不设，保持 pi 默认“不发字段”行为）
 * - minimal  → "minimal" 若有，否则降级到 "low"
 * - low/medium/high → 同名直映
 * - xhigh    → "xhigh" 若有，否则降 "high"
 * - max      → "max" 若有，否则降 "xhigh"，再降 "high"
 *
 * 2026-08-27 修订：pi 0.84.3 的 ThinkingLevel 枚举已含 max（此前仅到 xhigh，
 * max 需借 xhigh 通道发送）。现 max 独立成键直映 provider 的 max；xhigh 不再
 * 借道顶档，改为直映 xhigh。
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import type { RawModel } from "./registry.ts";

/**
 * Pi 的思考挡位（与 pi-agent-core 的 ModelThinkingLevel 保持同步）。
 * 硬编码以避免从 pi-coding-agent 主包导入内部类型。
 */
const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];
type ThinkingLevelMap = NonNullable<ProviderModelConfig["thinkingLevelMap"]>;

/**
 * 从 reasoning_options 中提取 effort 挡位列表。
 * 若模型未声明 effort（如仅 toggle / budget_tokens），返回 undefined。
 */
export function extractEffortValues(raw: RawModel): string[] | undefined {
  const opts = raw.reasoning_options;
  if (!Array.isArray(opts)) {
    return undefined;
  }
  for (const o of opts) {
    if (o?.type === "effort" && Array.isArray(o.values) && o.values.length > 0) {
      return o.values;
    }
  }
  return undefined;
}

/**
 * 根据 provider 支持的 effort 挡位构建 thinkingLevelMap。
 * 未声明 effort 的模型返回 undefined，pi 将原样发送挡位字符串（向后兼容）。
 */
export function buildThinkingLevelMap(values: string[] | undefined): ThinkingLevelMap | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  const set = new Set(values);
  const map: Partial<Record<PiThinkingLevel, string | null>> = {};

  if (set.has("none")) {
    map.off = "none";
  }
  if (set.has("minimal")) {
    map.minimal = "minimal";
  } else if (set.has("low")) {
    map.minimal = "low";
  }
  if (set.has("low")) {
    map.low = "low";
  }
  if (set.has("medium")) {
    map.medium = "medium";
  }
  if (set.has("high")) {
    map.high = "high";
  }
  // 顶档 xhigh：直映 xhigh，缺失降 high
  if (set.has("xhigh")) {
    map.xhigh = "xhigh";
  } else if (set.has("high")) {
    map.xhigh = "high";
  }
  // 顶档 max：直映 max，缺失降 xhigh，再降 high
  if (set.has("max")) {
    map.max = "max";
  } else if (set.has("xhigh")) {
    map.max = "xhigh";
  } else if (set.has("high")) {
    map.max = "high";
  }

  return map;
}
