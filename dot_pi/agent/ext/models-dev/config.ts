/**
 * 用户配置读取与校验（config 子模块）
 *
 * 配置文件：~/.pi/agent/models-dev.json（chezmoi 从 dotfiles 的
 * dot_pi/agent/models-dev.json 直接部署，独占文件无合并）。扩展启动时
 * 读取一次，reload/重启生效。
 *
 * 语义（优先级：模型级 > provider 级 > models.dev 自动判定）：
 * - disabled: true → 过滤（provider 整体不注册 / 模型不进注册列表）
 * - provider 级 api+baseUrl 双写 → 救活被协议判定跳过的 provider
 *   （用户显式指定 = 用户承担协议正确性）；单写其一仅覆盖已注册者属性
 * - api → 覆盖协议；baseUrl → 覆盖端点；name → 覆盖显示名
 * - 引用未知 provider/模型 id → 忽略（对齐 pi modelOverrides 语义）
 *
 * 失效模式（D16）：文件不存在 → 无配置（行为与现状一致）；JSON 语法错或
 * typebox 校验失败 → console 警告 + 退回无配置行为，不崩溃。
 * 配置 schema 文档见 ../AGENTS.md（JSON 无注释）。
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";

const CONFIG_FILE = join(homedir(), ".pi", "agent", "models-dev.json");

/** 本扩展可注册的 pi 协议（与 mapping.ts 的 Api 一致） */
const API_VALUES = [
  "anthropic-messages",
  "openai-completions",
  "openai-responses",
  "google-generative-ai",
  "google-vertex",
  "bedrock-converse-stream",
] as const;

const ApiSchema = Type.Union(API_VALUES.map((v) => Type.Literal(v)));

const ModelOverrideSchema = Type.Object(
  {
    disabled: Type.Optional(Type.Boolean()),
    api: Type.Optional(ApiSchema),
    baseUrl: Type.Optional(Type.String({ minLength: 1 })),
    name: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

const ProviderOverrideSchema = Type.Object(
  {
    disabled: Type.Optional(Type.Boolean()),
    api: Type.Optional(ApiSchema),
    baseUrl: Type.Optional(Type.String({ minLength: 1 })),
    models: Type.Optional(Type.Record(Type.String(), ModelOverrideSchema)),
  },
  { additionalProperties: false },
);

const ModelsDevConfigSchema = Type.Object(
  {
    providers: Type.Optional(Type.Record(Type.String(), ProviderOverrideSchema)),
  },
  { additionalProperties: false },
);

export type ApiValue = (typeof API_VALUES)[number];

/** 模型级覆盖 */
export interface ModelOverride {
  disabled?: boolean;
  api?: ApiValue;
  baseUrl?: string;
  name?: string;
}

/** provider 级覆盖 */
export interface ProviderOverride {
  disabled?: boolean;
  api?: ApiValue;
  baseUrl?: string;
  models?: Record<string, ModelOverride>;
}

export interface ModelsDevConfig {
  providers?: Record<string, ProviderOverride>;
}

export interface LoadConfigResult {
  /** 配置对象；null 表示无配置或校验失败（两种情况都按无配置行为走） */
  config: ModelsDevConfig | null;
  /** 配置存在但读取/校验失败时的警告信息（注册逻辑打日志用） */
  warning?: string;
}

/** 读取并校验用户配置；一切失败路径都返回 null 配置 + 可选警告，不抛错 */
export function loadConfig(): LoadConfigResult {
  let raw: string;
  try {
    raw = readFileSync(CONFIG_FILE, "utf8");
  } catch {
    // 文件不存在：无配置，正常路径
    return { config: null };
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return {
      config: null,
      warning: `models-dev 配置 JSON 解析失败，按无配置运行：${error instanceof Error ? error.message : error}`,
    };
  }
  if (!Check(ModelsDevConfigSchema, data)) {
    return {
      config: null,
      warning: "models-dev 配置 schema 校验失败（见 AGENTS.md 的 schema 说明），按无配置运行",
    };
  }
  return { config: data as ModelsDevConfig };
}
