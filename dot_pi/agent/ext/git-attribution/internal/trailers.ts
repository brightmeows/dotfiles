/**
 * 提交署名格式化与 git 运行时配置注入（纯库，无 Pi 运行时依赖）。
 *
 * 署名格式由 AGENTS.md 的提交规范决定：
 *
 *   Co-Authored-By: 白小喵（<模型ID> @ <provider>） <noreply@pi.dev>
 *   Generated-By: pi <版本>
 *
 * 模型取 PI_MODEL，去掉可能存在的 `${PI_PROVIDER}/` 前缀和 `:thinking` 后缀；
 * provider 取 PI_PROVIDER。模型缺失时只写“白小喵”，provider 缺失时省略
 * ` @ provider`，与 AGENTS.md 的退化规则一致。
 */

export const CO_AUTHOR_EMAIL = "noreply@pi.dev";

const THINKING_SUFFIX = /:(?:off|minimal|low|medium|high|xhigh|max)$/iu;
const UNSAFE_CHARS = /[\p{Cc}<>]/gu;
const WHITESPACE = /\s+/gu;
const CONFIG_COUNT = /^(?:0|[1-9]\d*)$/u;
const DISABLED_VALUES = new Set(["0", "false", "no", "off"]);

export interface Attribution {
  coAuthor: string;
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
export function buildAttribution(env: NodeJS.ProcessEnv, version: string): Attribution {
  const model = sanitizeModel(env["PI_MODEL"], env["PI_PROVIDER"]);
  const provider = sanitize(env["PI_PROVIDER"] ?? "");
  let name = "白小喵";
  if (model !== "") {
    name = provider === "" ? `白小喵（${model}）` : `白小喵（${model} @ ${provider}）`;
  }
  return {
    coAuthor: `Co-Authored-By: ${name} <${CO_AUTHOR_EMAIL}>`,
    generatedBy: `Generated-By: pi ${version}`,
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
