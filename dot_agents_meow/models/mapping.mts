/** Models.dev 目录与用户配置到 llm-pi-ai 路由的映射（纯函数，便于单测与干跑）。 */

import type {
  MappingStats,
  ModelsDevData,
  RawModel,
  RawProvider,
  ResolvedConfig,
  ResolvedProvider,
  Route,
  RouteModel,
} from "./types.mts";

const NPM_API_MAP: Record<string, string> = {
  "@ai-sdk/anthropic": "anthropic-messages",
  "@ai-sdk/google": "google-generative-ai",
  "@ai-sdk/google-vertex": "google-vertex",
  "@ai-sdk/amazon-bedrock": "bedrock-converse-stream",
  "@ai-sdk/openai": "openai-responses",
};
const OPENAI_COMPAT_NPM = new Set([
  "@ai-sdk/openai-compatible",
  "@openrouter/ai-sdk-provider",
  "@ai-sdk/azure",
]);
const OFFICIAL_OPENAI_BASE_URL = "https://api.openai.com/v1";
const OPENAI_FAMILY = new Set(["openai-completions", "openai-responses"]);
/** Dsh 的配置层只接受这三种协议；目录里其它协议（google 系、bedrock 等）跳过。 */
const SUPPORTED_PROTOCOLS = new Set([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
]);
/** Dsh 凭据名（环境变量名）的合法形式。 */
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** 档位顺序固定，保证输出确定性。 */
const EFFORT_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export interface MappingInputs {
  modelsDev: ModelsDevData;
  resolved: ResolvedConfig;
  env: Record<string, string | undefined>;
}

export interface MappingResult {
  routes: Record<string, Route>;
  stats: MappingStats;
}

/** 展开 ${ENV} 占位符；变量缺失或残留占位符时返回 undefined。 */
export function expandEnvUrl(
  value: string,
  env: Record<string, string | undefined>,
): string | undefined {
  if (!value.includes("${")) {
    return value;
  }
  let missing = false;
  const replaced = value.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
    const found = env[name];
    if (found === undefined || found === "") {
      missing = true;
      return "";
    }
    return found;
  });
  if (missing || replaced.includes("${")) {
    return undefined;
  }
  return replaced;
}

/** Npm 包名到协议的显式映射；未知 npm 返回 undefined（跳过，不猜测）。 */
export function mapNpm(npm: string | undefined): string | undefined {
  if (!npm) {
    return undefined;
  }
  const direct = NPM_API_MAP[npm];
  if (direct !== undefined) {
    return direct;
  }
  if (OPENAI_COMPAT_NPM.has(npm)) {
    return "openai-completions";
  }
  return undefined;
}

function effortValues(model: RawModel | undefined): string[] | undefined {
  for (const option of model?.reasoning_options ?? []) {
    if (option.type === "effort" && Array.isArray(option.values) && option.values.length > 0) {
      return option.values;
    }
  }
  return undefined;
}

/** 目录 effort 取值（含 none）到 dsh 档位的映射。 */
function effortsFromValues(values: string[]): Record<string, string> {
  const present = new Set(values);
  const efforts: Record<string, string> = {};
  for (const level of EFFORT_ORDER) {
    if (level === "off") {
      if (present.has("none")) {
        efforts["off"] = "none";
      }
      continue;
    }
    if (present.has(level)) {
      efforts[level] = level;
    }
  }
  return efforts;
}

/** 用户配置的 thinking_levels（加可选 thinking_wire）到 dsh 档位的映射。 */
function effortsFromLevels(
  levels: string[],
  wire: Record<string, string> | undefined,
): Record<string, string> {
  const efforts: Record<string, string> = {};
  for (const level of EFFORT_ORDER) {
    if (level === "off") {
      continue;
    }
    if (levels.includes(level)) {
      efforts[level] = wire?.[level] ?? level;
    }
  }
  return efforts;
}

interface ProviderWork {
  id: string;
  raw?: RawProvider;
  override?: ResolvedProvider;
  definition?: ResolvedProvider;
}

interface RouteShell {
  api: string;
  baseURL: string | undefined;
  apiKeyEnv: string | undefined;
  displayName: string;
  compat: Record<string, unknown> | undefined;
}

type ShellResult = { shell: RouteShell } | { reason: string };

function resolveShell(work: ProviderWork, env: Record<string, string | undefined>): ShellResult {
  const { id, raw, override, definition } = work;
  if (definition) {
    const { api } = definition;
    const baseURL = definition.base_url;
    if (api === undefined || baseURL === undefined) {
      return { reason: "定义缺少协议或端点" };
    }
    if (!SUPPORTED_PROTOCOLS.has(api)) {
      return { reason: `协议不受支持（${api}）` };
    }
    if (definition.api_key !== undefined && !CREDENTIAL_REF.test(definition.api_key)) {
      return { reason: `凭据名非法（${definition.api_key}）` };
    }
    return {
      shell: {
        api,
        baseURL,
        apiKeyEnv: definition.api_key,
        displayName: definition.name ?? id,
        compat: definition.compat,
      },
    };
  }
  const npmApi = mapNpm(raw?.npm);
  const revived = override?.api !== undefined && override?.base_url !== undefined;
  const api = override?.api ?? npmApi;
  if (api === undefined || (!npmApi && !revived)) {
    return { reason: "无法判定协议" };
  }
  if (!SUPPORTED_PROTOCOLS.has(api)) {
    return { reason: `协议不受支持（${api}）` };
  }
  let baseURL: string | undefined = override?.base_url;
  if (baseURL === undefined && raw?.api !== undefined) {
    baseURL = expandEnvUrl(raw.api, env);
  }
  if (baseURL === undefined && raw?.npm === "@ai-sdk/openai") {
    baseURL = OFFICIAL_OPENAI_BASE_URL;
  }
  if (baseURL === undefined && api === "openai-completions") {
    return { reason: "缺少端点" };
  }
  const apiKeyEnv = override?.api_key ?? raw?.env?.[0];
  if (apiKeyEnv !== undefined && !CREDENTIAL_REF.test(apiKeyEnv)) {
    return { reason: `凭据名非法（${apiKeyEnv}）` };
  }
  return {
    shell: {
      api,
      baseURL,
      apiKeyEnv,
      displayName: override?.name ?? raw?.name ?? id,
      compat: override?.compat,
    },
  };
}

function collectModelIds(work: ProviderWork): string[] {
  const ids: string[] = [];
  if (work.definition) {
    ids.push(...Object.keys(work.definition.models));
    return ids;
  }
  for (const id of Object.keys(work.raw?.models ?? {})) {
    ids.push(id);
  }
  for (const id of Object.keys(work.override?.models ?? {})) {
    if (!ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

interface BuiltModel {
  api: string;
  baseURL: string | undefined;
  model: RouteModel;
}

interface ModelBuildContext {
  work: ProviderWork;
  shell: RouteShell;
  env: Record<string, string | undefined>;
  stats: MappingStats;
}

/** 只保留正整数；目录里存在 0 值限额，直接透传会被 dsh schema 拒绝。 */
function positiveNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : undefined;
}

function buildModel(context: ModelBuildContext, modelId: string): BuiltModel | undefined {
  const { work, shell, env, stats } = context;
  const rawModel = work.raw?.models?.[modelId];
  const modelOverride = work.override?.models?.[modelId];
  const defModel = work.definition?.models?.[modelId];
  if (!rawModel && !defModel) {
    return undefined;
  }
  if (defModel?.disabled === true || modelOverride?.disabled === true) {
    return undefined;
  }

  let modelApi = shell.api;
  let modelBaseURL = shell.baseURL;
  if (!work.definition) {
    if (modelOverride?.api !== undefined) {
      modelApi = modelOverride.api;
    }
    if (modelOverride?.base_url !== undefined) {
      modelBaseURL = modelOverride.base_url;
    } else {
      const rawModelUrl = rawModel?.provider?.api;
      if (rawModelUrl !== undefined) {
        modelBaseURL = expandEnvUrl(rawModelUrl, env) ?? modelBaseURL;
      }
    }
    const shape = rawModel?.provider?.shape;
    if (shape !== undefined && OPENAI_FAMILY.has(modelApi)) {
      if (shape === "responses") {
        modelApi = "openai-responses";
      } else if (shape === "completions") {
        modelApi = "openai-completions";
      }
    }
    if (!SUPPORTED_PROTOCOLS.has(modelApi)) {
      stats.skippedModels.push(`${work.id}/${modelId}（协议不受支持：${modelApi}）`);
      return undefined;
    }
  }

  const rawContext =
    defModel?.context_window ?? modelOverride?.context_window ?? rawModel?.limit?.context;
  const rawMaxTokens = defModel?.max_tokens ?? modelOverride?.max_tokens ?? rawModel?.limit?.output;
  const contextWindow = positiveNumber(rawContext);
  const maxTokens = positiveNumber(rawMaxTokens);
  if (
    (rawContext !== undefined && contextWindow === undefined) ||
    (rawMaxTokens !== undefined && maxTokens === undefined)
  ) {
    stats.droppedLimits += 1;
  }
  const rawInput = defModel?.input ?? modelOverride?.input ?? rawModel?.modalities?.input;
  const input = rawInput?.filter((item) => item === "text" || item === "image");
  const name = defModel?.name ?? modelOverride?.name ?? rawModel?.name ?? modelId;

  let reasoningEfforts: RouteModel["reasoningEfforts"];
  const levels = defModel?.thinking_levels ?? modelOverride?.thinking_levels;
  if (levels !== undefined) {
    const wire = defModel?.thinking_wire ?? modelOverride?.thinking_wire;
    const built = effortsFromLevels(levels, wire);
    reasoningEfforts = Object.keys(built).length > 0 ? built : undefined;
  } else if (defModel !== undefined) {
    reasoningEfforts = defModel.reasoning === true ? undefined : false;
  } else {
    const values = rawModel === undefined ? undefined : effortValues(rawModel);
    if (values !== undefined) {
      const built = effortsFromValues(values);
      reasoningEfforts = Object.keys(built).length > 0 ? built : undefined;
    } else if (rawModel?.reasoning === false) {
      reasoningEfforts = false;
    }
  }

  const compat = modelOverride?.compat ?? defModel?.compat;
  const model: RouteModel = { id: modelId, name };
  if (contextWindow !== undefined) {
    model.contextWindow = contextWindow;
  }
  if (maxTokens !== undefined) {
    model.maxTokens = maxTokens;
  }
  if (input !== undefined && input.length > 0) {
    model.input = input;
  }
  if (reasoningEfforts !== undefined) {
    model.reasoningEfforts = reasoningEfforts;
  }
  if (compat !== undefined) {
    model.compat = compat;
  }
  return { api: modelApi, baseURL: modelBaseURL, model };
}

function groupKey(api: string, baseURL: string | undefined): string {
  return `${api}|||${baseURL ?? ""}`;
}

/** 合成全部路由：目录 provider 叠加用户覆盖，定义类 provider 直接构造。 */
export function buildRoutes(inputs: MappingInputs): MappingResult {
  const { modelsDev, resolved, env } = inputs;
  const disabledList = resolved.disabled_providers ?? [];
  const disabled = new Set(disabledList);
  const overrides = resolved.providers ?? {};
  const routes: Record<string, Route> = {};
  const stats: MappingStats = {
    providers: 0,
    models: 0,
    skippedProviders: [],
    skippedModels: [],
    shadowed: [],
    droppedLimits: 0,
  };

  const work: ProviderWork[] = [];
  for (const [id, raw] of Object.entries(modelsDev)) {
    if (disabled.has(id)) {
      continue;
    }
    const entry = overrides[id];
    if (entry?.kind === "definition") {
      stats.shadowed.push(id);
      work.push({ id, definition: entry });
    } else if (entry !== undefined) {
      work.push({ id, raw, override: entry });
    } else {
      work.push({ id, raw });
    }
  }
  for (const [id, entry] of Object.entries(overrides)) {
    if (entry.kind !== "definition" || disabled.has(id) || Object.hasOwn(modelsDev, id)) {
      continue;
    }
    work.push({ id, definition: entry });
  }

  for (const item of work) {
    const shellResult = resolveShell(item, env);
    if ("reason" in shellResult) {
      stats.skippedProviders.push(`${item.id}（${shellResult.reason}）`);
      continue;
    }
    const { shell } = shellResult;
    const groups = new Map<
      string,
      { api: string; baseURL: string | undefined; models: RouteModel[] }
    >();
    const context: ModelBuildContext = { work: item, shell, env, stats };
    for (const modelId of collectModelIds(item)) {
      const built = buildModel(context, modelId);
      if (built === undefined) {
        if (!item.definition && item.raw?.models?.[modelId] === undefined) {
          stats.skippedModels.push(`${item.id}/${modelId}`);
        }
        continue;
      }
      const key = groupKey(built.api, built.baseURL);
      let group = groups.get(key);
      if (group === undefined) {
        group = { api: built.api, baseURL: built.baseURL, models: [] };
        groups.set(key, group);
      }
      group.models.push(built.model);
    }
    const ordered = [...groups.entries()];
    if (ordered.length === 0) {
      stats.skippedProviders.push(`${item.id}（无可用模型）`);
      continue;
    }
    const primaryKey = groupKey(shell.api, shell.baseURL);
    ordered.sort((left, right) => {
      if (left[0] === primaryKey) {
        return -1;
      }
      if (right[0] === primaryKey) {
        return 1;
      }
      return 0;
    });
    ordered.forEach(([, group], index) => {
      let routeId = index === 0 ? item.id : `${item.id}-${index + 1}`;
      let suffix = index + 1;
      while (Object.hasOwn(routes, routeId)) {
        suffix += 1;
        routeId = `${item.id}-${suffix}`;
      }
      const route: Route = {
        displayName: index === 0 ? shell.displayName : `${shell.displayName} (${index + 1})`,
        api: group.api,
        models: group.models,
      };
      if (shell.apiKeyEnv !== undefined) {
        route.apiKeyEnv = shell.apiKeyEnv;
      }
      if (group.baseURL !== undefined) {
        route.baseURL = group.baseURL;
      }
      if (shell.compat !== undefined) {
        route.compat = shell.compat;
      }
      routes[routeId] = route;
      stats.providers += 1;
      stats.models += group.models.length;
    });
  }
  return { routes, stats };
}

const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const RESERVED_KEYS = new Set(["true", "false", "yes", "no", "on", "off", "null", "~"]);

function yamlKey(key: string): string {
  if (PLAIN_KEY.test(key) && !RESERVED_KEYS.has(key.toLowerCase())) {
    return key;
  }
  return JSON.stringify(key);
}

function yamlScalar(value: string | number | boolean): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return String(value);
}

function renderCompat(compat: Record<string, unknown>, indent: string): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(compat)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      lines.push(`${indent}${yamlKey(key)}: ${yamlScalar(value)}`);
    } else if (value !== undefined && value !== null) {
      lines.push(`${indent}${yamlKey(key)}: ${JSON.stringify(value)}`);
    }
  }
  return lines;
}

/** 渲染 patch 块文本（不含标记行）。 */
export function renderManagedBlock(routes: Record<string, Route>): string {
  const lines: string[] = ["- id: llm-pi-ai", "  config:", "    providers:"];
  for (const [routeId, route] of Object.entries(routes)) {
    lines.push(`      ${yamlKey(routeId)}:`);
    if (route.apiKeyEnv !== undefined) {
      lines.push(`        apiKeyEnv: ${yamlScalar(route.apiKeyEnv)}`);
    }
    lines.push(`        displayName: ${yamlScalar(route.displayName)}`);
    lines.push(`        api: ${yamlScalar(route.api)}`);
    if (route.baseURL !== undefined) {
      lines.push(`        baseURL: ${yamlScalar(route.baseURL)}`);
    }
    if (route.compat !== undefined) {
      lines.push("        compat:");
      lines.push(...renderCompat(route.compat, "          "));
    }
    lines.push("        models:");
    for (const model of route.models) {
      lines.push(`          - id: ${yamlScalar(model.id)}`);
      lines.push(`            name: ${yamlScalar(model.name)}`);
      if (model.contextWindow !== undefined) {
        lines.push(`            contextWindow: ${yamlScalar(model.contextWindow)}`);
      }
      if (model.maxTokens !== undefined) {
        lines.push(`            maxTokens: ${yamlScalar(model.maxTokens)}`);
      }
      if (model.input !== undefined) {
        lines.push(
          `            input: [${model.input.map((item) => yamlScalar(item)).join(", ")}]`,
        );
      }
      if (model.reasoningEfforts === false) {
        lines.push("            reasoningEfforts: false");
      } else if (
        model.reasoningEfforts !== undefined &&
        Object.keys(model.reasoningEfforts).length > 0
      ) {
        lines.push("            reasoningEfforts:");
        for (const [level, wire] of Object.entries(model.reasoningEfforts)) {
          lines.push(`              ${yamlKey(level)}: ${yamlScalar(wire)}`);
        }
      }
      if (model.compat !== undefined) {
        lines.push("            compat:");
        lines.push(...renderCompat(model.compat, "              "));
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

/** 写出前的本地校验：拦住会触发 dsh schema 拒绝的取值（协议、限额、模态、档位）。 */
export function validateRoutes(routes: Record<string, Route>): string[] {
  const problems: string[] = [];
  for (const [routeId, route] of Object.entries(routes)) {
    if (!SUPPORTED_PROTOCOLS.has(route.api)) {
      problems.push(`${routeId}: 协议不受支持（${route.api}）`);
    }
    if (route.apiKeyEnv !== undefined && !CREDENTIAL_REF.test(route.apiKeyEnv)) {
      problems.push(`${routeId}: 凭据名非法（${route.apiKeyEnv}）`);
    }
    if (route.models.length === 0) {
      problems.push(`${routeId}: 没有任何模型`);
    }
    for (const model of route.models) {
      const where = `${routeId}/${model.id}`;
      if (!model.id) {
        problems.push(`${routeId}: 模型缺少 id`);
      }
      if (
        model.contextWindow !== undefined &&
        (!Number.isInteger(model.contextWindow) || model.contextWindow < 1)
      ) {
        problems.push(`${where}: contextWindow 非法（${model.contextWindow}）`);
      }
      if (
        model.maxTokens !== undefined &&
        (!Number.isInteger(model.maxTokens) || model.maxTokens < 1)
      ) {
        problems.push(`${where}: maxTokens 非法（${model.maxTokens}）`);
      }
      if (
        model.input !== undefined &&
        model.input.some((item) => item !== "text" && item !== "image")
      ) {
        problems.push(`${where}: input 含未知模态`);
      }
      if (model.reasoningEfforts !== undefined && model.reasoningEfforts !== false) {
        for (const level of Object.keys(model.reasoningEfforts)) {
          if (!EFFORT_ORDER.includes(level)) {
            problems.push(`${where}: 档位非法（${level}）`);
          }
        }
      }
    }
  }
  return problems;
}
