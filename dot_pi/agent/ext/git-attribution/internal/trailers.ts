/**
 * 提交署名格式化与 git 运行时配置注入（纯库，无 Pi 运行时依赖）。
 *
 * 署名格式：
 *
 *   Co-Authored-By: <配置姓名> <配置邮箱>
 *   Generated-By: pi <版本> (<模型ID> @ <provider>, reasoning=<档位>)
 *
 * Co-Authored-By 只保留身份；模型、provider 与 reasoning 放进 Generated-By。
 * 模型取 PI_MODEL，去掉可能存在的 `${PI_PROVIDER}/` 前缀和 `:thinking` 后缀；
 * provider 取 PI_PROVIDER；reasoning 取 PI_REASONING_LEVEL，只接受已知档位。
 * 缺失字段按实际可用内容拼接，全部缺失时只留 `Generated-By: pi <版本>`。
 */

import { type AttributionConfig, DEFAULT_CONFIG, normalizeEmail, sanitizeName } from "./config.ts";

const THINKING_SUFFIX = /:(?:off|minimal|low|medium|high|xhigh|max)$/iu;
const UNSAFE_CHARS = /[\p{Cc}<>]/gu;
const WHITESPACE = /\s+/gu;
const CONFIG_COUNT = /^(?:0|[1-9]\d*)$/u;
const DISABLED_VALUES = new Set(["0", "false", "no", "off"]);
const REASONING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export interface Attribution {
  coAuthor: string;
  coAuthorEmail: string;
  generatedBy: string;
}

/** 识别环境变量里的关闭值；与会话级退出约定一致。 */
export function isAttributionDisabled(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  return DISABLED_VALUES.has(value.trim().toLowerCase());
}

/** 生成当前模型对应的两条 trailer。 */
export function buildAttribution(
  env: NodeJS.ProcessEnv,
  version: string,
  config: AttributionConfig = DEFAULT_CONFIG,
): Attribution {
  const name = sanitizeName(config.coAuthor.name);
  const email = normalizeEmail(config.coAuthor.email) ?? DEFAULT_CONFIG.coAuthor.email;
  const model = sanitizeModel(env["PI_MODEL"], env["PI_PROVIDER"]);
  const provider = sanitize(env["PI_PROVIDER"] ?? "");
  const reasoning = sanitizeReasoning(env["PI_REASONING_LEVEL"]);
  const parts: string[] = [];
  if (model !== "") {
    parts.push(provider === "" ? model : `${model} @ ${provider}`);
  }
  if (reasoning !== undefined) {
    parts.push(`reasoning=${reasoning}`);
  }
  const suffix = parts.length === 0 ? "" : ` (${parts.join(", ")})`;
  return {
    coAuthor: `Co-Authored-By: ${name} <${email}>`,
    coAuthorEmail: email,
    generatedBy: `Generated-By: pi ${version}${suffix}`,
  };
}

/**
 * 在现有 git 运行时配置后追加一条 core.hooksPath。
 *
 * GIT_CONFIG_COUNT 可能已被其他工具占用，因此按原计数追加，不覆盖已有条目。
 * 计数非法时原样返回，让调用方走失败放行。
 */
export function withGitConfig(
  env: NodeJS.ProcessEnv,
  hooksDir: string,
  attribution: Attribution,
): NodeJS.ProcessEnv {
  const count = parseConfigCount(env["GIT_CONFIG_COUNT"]);
  if (count === undefined) {
    return env;
  }
  return {
    ...env,
    GIT_CONFIG_COUNT: String(count + 1),
    [`GIT_CONFIG_KEY_${count}`]: "core.hooksPath",
    [`GIT_CONFIG_VALUE_${count}`]: hooksDir,
    PI_GIT_ATTRIBUTION_CONFIG_INDEX: String(count),
    PI_GIT_ATTRIBUTION_CO_AUTHOR: attribution.coAuthor,
    PI_GIT_ATTRIBUTION_CO_AUTHOR_EMAIL: attribution.coAuthorEmail,
    PI_GIT_ATTRIBUTION_GENERATED_BY: attribution.generatedBy,
  };
}

function sanitizeModel(modelValue: string | undefined, providerValue: string | undefined): string {
  const provider = sanitize(providerValue ?? "");
  let model = sanitize(modelValue ?? "");
  if (provider !== "" && model.startsWith(`${provider}/`)) {
    model = model.slice(provider.length + 1);
  }
  model = model.replace(THINKING_SUFFIX, "");
  return model === "unknown" ? "" : model;
}

function sanitize(value: string): string {
  return value.replaceAll(UNSAFE_CHARS, " ").replaceAll(WHITESPACE, " ").trim();
}

function sanitizeReasoning(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const level = value.trim().toLowerCase();
  return REASONING_LEVELS.has(level) ? level : undefined;
}

function parseConfigCount(value: string | undefined): number | undefined {
  if (value === undefined || value === "") {
    return 0;
  }
  if (!CONFIG_COUNT.test(value)) {
    return undefined;
  }
  const count = Number(value);
  return Number.isSafeInteger(count) ? count : undefined;
}
