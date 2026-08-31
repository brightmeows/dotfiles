/**
 * Models.dev 注册表拉取与缓存（registry 子模块）
 *
 * 职责：从 https://models.dev/api.json 拉取 provider 注册表，缓存 24 小时至
 * ~/.pi/agent/cache/models-dev-registry.json，TTL 内跳过网络请求、网络失败
 * 回退过期缓存。另含 models.dev 原始 JSON 的类型定义与 baseUrl 归一化。
 *
 * 缓存 schema 即 api.json 原始数据（fetchWithCache 直存直读），协议判定与
 * 模型映射在 mapping.ts 消费，不在本模块。
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const MODELS_DEV_URL = "https://models.dev/api.json";
const CACHE_DIR = join(homedir(), ".pi", "agent", "cache");
const CACHE_FILE = join(CACHE_DIR, "models-dev-registry.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时

// ── Raw JSON types (subset of what api.json provides) ──

export interface RawReasoningOption {
  type: "effort" | "budget_tokens" | "toggle";
  /** 仅 type === "effort" 时有意义 */
  values?: string[];
}

export interface RawCostTier {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  /** 分级阈值描述：type 固定 context，size 即 inputTokensAbove */
  tier?: { type?: string; size?: number };
}

export interface RawCost {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  /** 旧形式分级定价（阈值固定 200000）；新数据用 tiers */
  context_over_200k?: Omit<RawCost, "context_over_200k" | "tiers">;
  tiers?: RawCostTier[];
}

export interface RawModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  reasoning_options?: RawReasoningOption[];
  modalities?: { input?: string[] };
  limit?: { context?: number; output?: number };
  cost?: RawCost;
  /** 模型级 [provider] 覆盖段（协议判定与端点覆盖的单一事实来源） */
  provider?: {
    /** AI SDK 包名覆盖（pi 不消费，仅记录） */
    npm?: string;
    /** 端点覆盖（可能含 ${ENV} 占位符，见 mapping.ts 展开） */
    api?: string;
    /** 协议形状：responses / completions（仅 openai 族生效） */
    shape?: string;
  };
}

export interface RawProvider {
  id: string;
  env?: string[];
  /** 端点 base URL（部分 provider 缺失，如官方 OpenAI） */
  api?: string;
  /** AI SDK 集成包名（协议判定的权威依据） */
  npm?: string;
  name?: string;
  models?: Record<string, RawModel>;
}

export interface CacheEntry {
  fetchedAt: number;
  data: Record<string, RawProvider>;
}

// ── 缓存管理 ──

export function fetchWithCache(): Promise<Record<string, RawProvider> | null> {
  // 先尝试读缓存
  const cached = readCache();
  if (cached) {
    const age = Date.now() - cached.fetchedAt;
    if (age < CACHE_TTL_MS) {
      return Promise.resolve(cached.data); // TTL 内，直接用
    }
    // 缓存过期，后台异步刷新，但先用过期数据
    refreshCacheAsync();
    return Promise.resolve(cached.data);
  }

  // 无缓存，同步拉取
  return fetchAndSave();
}

function readCache(): CacheEntry | null {
  try {
    const raw = readFileSync(CACHE_FILE, "utf8");
    const entry = JSON.parse(raw) as CacheEntry;
    if (entry && typeof entry.fetchedAt === "number" && entry.data) {
      return entry;
    }
  } catch {
    // 文件不存在 / 解析失败，忽略
  }
  return null;
}

async function refreshCacheAsync(): Promise<void> {
  try {
    const res = await fetch(MODELS_DEV_URL);
    if (!res.ok) {
      return;
    }
    const data = (await res.json()) as Record<string, RawProvider>;
    saveCache(data);
    console.error("[models-dev] Cache updated");
  } catch {
    // 后台刷新失败不报错——stale 数据已用
  }
}

async function fetchAndSave(): Promise<Record<string, RawProvider> | null> {
  try {
    const res = await fetch(MODELS_DEV_URL);
    if (!res.ok) {
      console.error(`[models-dev] Fetch failed: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as Record<string, RawProvider>;
    saveCache(data);
    return data;
  } catch (error) {
    console.error(`[models-dev] Fetch failed: ${error instanceof Error ? error.message : error}`);
    return null; // 首次拉取失败，不阻塞启动
  }
}

function saveCache(data: Record<string, RawProvider>): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const entry: CacheEntry = { data, fetchedAt: Date.now() };
    writeFileSync(CACHE_FILE, JSON.stringify(entry), "utf8");
  } catch (error) {
    console.error(
      `[models-dev] Cache write failed: ${error instanceof Error ? error.message : error}`,
    );
  }
}

/** 标准化 baseUrl：去掉 pi 会追加的路径段 */
export function normalizeBaseUrl(url: string): string {
  return url
    .replace(/\/chat\/completions\/?$/, "") // Pi 追加 /chat/completions
    .replace(/\/$/, ""); // 去尾斜杠
}
