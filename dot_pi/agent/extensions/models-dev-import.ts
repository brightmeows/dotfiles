/**
 * Models.dev Provider Import Extension
 *
 * 启动时从 https://models.dev/api.json 拉取 provider 注册表，
 * 自动将其中所有 OpenAI 兼容 provider 注册至 pi。
 *
 * 效果：/model 列表中出现数百个新模型，按 provider 分组。
 *

 *
 * 缓存：注册表缓存 24 小时至 ~/.pi/agent/cache/models-dev-registry.json，
 * TTL 内跳过网络请求。网络失败时回退至过期缓存。
 *
 * 可用性过滤：注册前检查 provider.env 中声明的所有环境变量，
 * 只要有一个缺失（未设置 / 为空字符串）则跳过该 provider，
 * 确保 /model 列表中只出现当前可用的模型。
 *
 * API key：直接传递 process.env 解析后的实际值而非变量名，
 * 避免 pi 内置 resolveConfigValueOrThrow 在部分运行时中
 * 解析失败的问题。
 */

import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MODELS_DEV_URL = "https://models.dev/api.json";
const CACHE_DIR = join(homedir(), ".pi", "agent", "cache");
const CACHE_FILE = join(CACHE_DIR, "models-dev-registry.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时

// ── 已知非标准 OpenAI 兼容 API 需禁用 developer role / store 等特性 ──
// 每项可为字符串（URL 子串匹配）或正则表达式
const NEEDS_DEVELOPER_ROLE_DISABLED: (string | RegExp)[] = ["open.bigmodel.cn"];

function matchesAny(pattern: string | RegExp, url: string): boolean {
  return typeof pattern === "string" ? url.includes(pattern) : pattern.test(url);
}

// ── Raw JSON types (subset of what api.json provides) ──
interface RawModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  modalities?: { input?: string[] };
  limit?: { context?: number; output?: number };
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
  };
}

interface RawProvider {
  id: string;
  env?: string[];
  api?: string;
  name?: string;
  models?: Record<string, RawModel>;
}

interface CacheEntry {
  fetchedAt: number;
  data: Record<string, RawProvider>;
}

// ── 实现 ──
export default async function (pi: ExtensionAPI) {
  const registry = await fetchWithCache();
  if (!registry) {
    return;
  }

  const registeredNames: string[] = [];
  for (const [pid, provider] of Object.entries(registry)) {
    if (!provider.api) {
      continue;
    } // 非 OpenAI 兼容 provider（内建引用）

    if (!provider.models) {
      continue;
    }

    const rawList = Object.values(provider.models).filter((m): m is RawModel => Boolean(m.id));
    if (rawList.length === 0) {
      continue;
    }

    const models = rawList.map(mapModel).filter((m): m is ProviderModelConfig => m !== null);
    if (models.length === 0) {
      continue;
    }

    // ── compat 覆写：对非标准 OpenAI 兼容 API 禁用不兼容的特性 ──
    const baseUrl = provider.api ?? "";
    if (NEEDS_DEVELOPER_ROLE_DISABLED.some((p) => matchesAny(p, baseUrl))) {
      for (const m of models) {
        m.compat = {
          maxTokensField: "max_tokens",
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsStore: false,
          thinkingFormat: "zai",
        };
      }
    }

    // ── 环境变量守卫：所有声明的 env var 必须存在且非空 ──
    const envVars = provider.env ?? [];
    const missing = envVars.filter((e) => !process.env[e]);
    if (missing.length > 0) {
      continue;
    }

    const envKey = provider.env?.[0];
    const apiKeyLiteral = envKey ? process.env[envKey] || undefined : undefined;
    pi.registerProvider(pid, {
      name: provider.name ?? pid,
      baseUrl: normalizeBaseUrl(provider.api),
      ...(apiKeyLiteral ? { apiKey: apiKeyLiteral } : {}),
      api: "openai-completions",
      models,
    });
    registeredNames.push(provider.name ?? pid);
  }

  // ── 启动后发一条汇总提示 ──
  if (registeredNames.length > 0) {
    pi.on("session_start", async (event, ctx) => {
      if (event.reason === "startup") {
        ctx.ui.notify(
          `已注册 ${registeredNames.length} 个 models.dev 提供商：${registeredNames.join(", ")}`,
          "info",
        );
      }
    });
  }
}

// 静默注册成功。仅出错时提示。

// ── 缓存管理 ──

function fetchWithCache(): Promise<Record<string, RawProvider> | null> {
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

// ── 辅助函数 ──

/** 标准化 baseUrl：去掉 pi 会追加的路径段 */
function normalizeBaseUrl(url: string): string {
  return url
    .replace(/\/chat\/completions\/?$/, "") // Pi 追加 /chat/completions
    .replace(/\/$/, ""); // 去尾斜杠
}

/** 映射 models.dev 模型格式 → pi ProviderModelConfig */
function mapModel(raw: RawModel): ProviderModelConfig | null {
  if (!raw.id) {
    return null;
  }

  const input: ("text" | "image")[] = ["text"];
  if (raw.modalities?.input?.includes("image")) {
    input.push("image");
  }

  return {
    contextWindow: raw.limit?.context ?? 128_000,
    cost: {
      cacheRead: raw.cost?.cache_read ?? 0,
      cacheWrite: raw.cost?.cache_write ?? 0,
      input: raw.cost?.input ?? 0,
      output: raw.cost?.output ?? 0,
    },
    id: raw.id,
    input,
    maxTokens: raw.limit?.output ?? 16_384,
    name: raw.name ?? raw.id,
    reasoning: raw.reasoning ?? false,
  };
}
