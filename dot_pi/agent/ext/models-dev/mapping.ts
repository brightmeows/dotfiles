/**
 * 协议判定与模型映射（mapping 子模块）
 *
 * 协议感知：消费 models.dev 的两层协议字段——
 * - provider 层 `npm`（AI SDK 集成包名）：显式映射到 pi 协议（Q7 约定）
 * - 模型层 `provider.shape`（"responses"/"completions"）：覆盖 provider 层
 *   协议（Q8 约定，仅 openai 族生效），`provider.api` 覆盖模型 baseUrl
 * - openai 官方（npm=`@ai-sdk/openai`）无 api 字段也注册，默认走
 *   openai-responses（Q12 约定，OpenAI 官方主推协议，依据：
 *   developers.openai.com/api/docs/guides/migrate-to-responses
 *   "Responses is recommended for all new projects"）
 *
 * 判定顺序（单一事实来源：映射表 > 官方默认 > 兼容白名单 > 跳过）：
 * 1. npm 命中显式映射表（anthropic/google/bedrock 等）→ 对应协议
 * 2. npm=@ai-sdk/openai（官方）→ openai-responses，baseUrl 缺省官方默认
 * 3. npm 命中兼容白名单（openai-compatible/openrouter/azure）→ openai-completions，须有 api
 * 4. 其余未知 npm → 跳过不注册（避免把未知协议误注册为 openai-completions）
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { normalizeBaseUrl, type RawModel, type RawProvider } from "./registry.ts";
import { buildThinkingLevelMap, extractEffortValues } from "./thinking.ts";

/** Pi 支持的协议子集（本扩展会注册到的） */
export type Api =
  | "anthropic-messages"
  | "openai-completions"
  | "openai-responses"
  | "google-generative-ai"
  | "google-vertex"
  | "bedrock-converse-stream";

/** Provider 层 npm → Pi 协议 的显式映射（非 openai 系，单一事实来源） */
const NPM_API_MAP: Readonly<Record<string, Api>> = {
  "@ai-sdk/anthropic": "anthropic-messages",
  "@ai-sdk/google": "google-generative-ai",
  "@ai-sdk/google-vertex": "google-vertex",
  "@ai-sdk/amazon-bedrock": "bedrock-converse-stream",
};

/** OpenAI 官方 npm：无 api 字段也注册，默认走 responses（Q12） */
const OFFICIAL_OPENAI_NPM = "@ai-sdk/openai";
const OFFICIAL_OPENAI_BASE_URL = "https://api.openai.com/v1";

/** OpenAI 兼容 npm 白名单：默认 openai-completions，须显式 api 端点 */
const OPENAI_COMPAT_NPM = new Set([
  "@ai-sdk/openai-compatible",
  "@openrouter/ai-sdk-provider",
  "@ai-sdk/azure",
]);

/** 协议判定结果：provider 级协议 + baseUrl + 是否 openai 族（shape 覆盖范围） */
export interface ResolvedProvider {
  api: Api;
  /** Provider 级 baseUrl（可为空串，由调用方决定是否回退） */
  baseUrl: string | null;
  /** 是否 openai 族：模型层 shape 覆盖只对 openai 族生效 */
  isOpenAiFamily: boolean;
}

/**
 * 判定 provider 的协议与端点。返回 null 表示该 provider 不可注册
 * （npm 未知 / openai 兼容缺端点）。
 */
export function resolveProviderApi(provider: RawProvider): ResolvedProvider | null {
  const npm = provider.npm ?? "";
  if (!npm) {
    return null;
  }

  const explicit = NPM_API_MAP[npm];
  if (explicit) {
    // 显式映射：anthropic/google/bedrock 等，baseUrl 直接用 provider.api（可缺省）
    return { api: explicit, baseUrl: provider.api ?? null, isOpenAiFamily: false };
  }

  if (npm === OFFICIAL_OPENAI_NPM) {
    // 官方 OpenAI：无 api 字段也注册，默认 baseUrl + responses
    return {
      api: "openai-responses",
      baseUrl: provider.api ?? OFFICIAL_OPENAI_BASE_URL,
      isOpenAiFamily: true,
    };
  }

  if (OPENAI_COMPAT_NPM.has(npm)) {
    if (!provider.api) {
      return null; // OpenAI 兼容必须显式端点，缺则跳过
    }
    return { api: "openai-completions", baseUrl: provider.api, isOpenAiFamily: true };
  }

  return null; // 未知 npm：跳过，不猜测协议
}

/** ${ENV} 占位符展开；任一变量缺失或展开后仍残留 ${ 返回 null（回退 Provider 级端点） */
function expandEnvVars(url: string): string | null {
  if (!url.includes("${")) {
    return url;
  }
  let missing = false;
  const replaced = url.replace(/\$\{([^}]+)\}/g, (_, name: string) => {
    const value = process.env[name];
    if (value === undefined || value === "") {
      missing = true;
      return "";
    }
    return value;
  });
  // 变量缺失或展开后仍含 ${（变量名畸形）→ 不可用
  return missing || replaced.includes("${") ? null : replaced;
}

/**
 * 应用模型层 shape 覆盖（仅 openai 族）：
 * shape=responses → openai-responses，shape=completions → openai-completions。
 */
function applyShape(api: Api, shape: string | undefined, isOpenAiFamily: boolean): Api {
  if (!isOpenAiFamily) {
    return api;
  }
  if (shape === "responses") {
    return "openai-responses";
  }
  if (shape === "completions") {
    return "openai-completions";
  }
  return api;
}

/**
 * 映射 models.dev 模型 → pi ProviderModelConfig。
 * 协议与端点：模型层 `provider.api`（含 ${ENV} 展开）优先，否则用 provider 级
 * baseUrl；`provider.shape` 覆盖协议（仅 openai 族）。
 */
export function mapModel(raw: RawModel, resolved: ResolvedProvider): ProviderModelConfig | null {
  if (!raw.id) {
    return null;
  }

  const input: ("text" | "image")[] = ["text"];
  if (raw.modalities?.input?.includes("image")) {
    input.push("image");
  }

  // 从 reasoning_options.effort 构建挡位映射（thinkingLevelMap）及 compat 翻转。
  const effortValues = extractEffortValues(raw);
  const thinkingLevelMap = buildThinkingLevelMap(effortValues);

  // 模型级端点覆盖：provider.api（展开 ${ENV}）> Provider 级 baseUrl；占位符失败或空值回退 Provider 级
  const { baseUrl: providerBaseUrl } = resolved;
  const modelApiOverride = raw.provider?.api ? expandEnvVars(raw.provider.api) : null;
  const baseUrl = modelApiOverride || providerBaseUrl;

  const api = applyShape(resolved.api, raw.provider?.shape, resolved.isOpenAiFamily);

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
    api,
    ...(baseUrl ? { baseUrl: normalizeBaseUrl(baseUrl) } : {}),
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    ...(effortValues ? { compat: { supportsReasoningEffort: true } } : {}),
  };
}
