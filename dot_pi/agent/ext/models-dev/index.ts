/**
 * 模型目录导入域扩展合并入口（models-dev）
 *
 * Pi 扩展发现只支持一层子目录 + 单一入口（index.ts），本目录收纳 models.dev
 * provider 注册表导入：
 * - registry.ts：拉取与缓存（models.dev/api.json，24h TTL；离线守卫与刷新合流）
 * - config.ts：用户配置读取与校验（~/.pi/agent/models-dev.json，chezmoi 维护）
 * - mapping.ts：协议判定（npm→api 映射 + 模型层 shape/api 覆盖）与模型映射
 * - thinking.ts：思考挡位映射（pi 层级含 max）
 * - native.ts：原生 Provider 构建（M2-hybrid；与内建不重名者走原生）
 *
 * 编排（async factory，入口 await 保证顺序）：读配置 → 遍历 provider →
 * 配置过滤（disabled）→ 协议判定 → 配置救活/覆盖 → 模型映射（含模型级
 * disabled 过滤与内建 compat 合并）→ env 守卫 → 按内建重名分流注册。
 *
 * 注册分流（2026-10-03，M2-hybrid）：pi 1.0 原生注册是顶层替换，注册原生
 * provider 会顶掉同名内建（含 OAuth 登录与目录合成），故与内建重名的 id
 * 仍走 legacy registerProvider（与内建 base 合成、保留内建 auth），非重名
 * id 走原生 createProvider（auth / 刷新 / ModelsStore 持久化交给平台）。
 *
 * 目录组织（2026-08-27 拆包）：由 tools/ 拆出独立成域并做协议感知改造；
 * 同日接入用户配置（黑名单过滤 / 协议端点覆盖 / 救活被跳过 provider）。
 *
 * 优先级（2026-09-08 修订）：配置文件 models.json > models-dev 扩展 > pi 内置
 * 目录。models.json 显式声明的 provider 进入保护名单，扩展跳过注册，避免
 * registerProvider 带 models 整体替换 pi 已合成的模型列表（覆盖自定义）。
 *
 * compat 合并（2026-10-04）：与内建重名的 provider 在模型映射时按 id|api 合并
 * pi-ai 内建模型的 compat 与档位映射（内建显式键优先），修复扩展注册整体替换
 * 导致的 thinkingFormat/strict 工具/zaiToolStream 等丢失；见 internal/mapping.ts。
 */

import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import {
  getBuiltinModels,
  getBuiltinProviders,
  type BuiltinProvider,
} from "@earendil-works/pi-ai/providers/all";
import {
  fetchForRefresh,
  fetchWithCache,
  type RawModel,
  type RawProvider,
} from "./internal/registry.ts";
import { loadConfig, type ProviderOverride } from "./internal/config.ts";
import { loadCustomProviderIds } from "./internal/custom-models.ts";
import { buildNativeProvider } from "./internal/native.ts";
import {
  isOpenAiFamilyApi,
  mapModel,
  resolveProviderApi,
  type BuiltinCompatSource,
  type ResolvedProvider,
} from "./internal/mapping.ts";

/** 内建 provider 的适配索引（id|api → compat/档位），供 mapModel 合并；仅重名 provider 构建 */
function buildBuiltinCompatIndex(pid: BuiltinProvider): Map<string, BuiltinCompatSource> {
  const index = new Map<string, BuiltinCompatSource>();
  for (const model of getBuiltinModels(pid)) {
    index.set(`${model.id}|${model.api}`, {
      compat: model.compat,
      thinkingLevelMap: model.thinkingLevelMap,
    });
  }
  return index;
}

/** 函数 mapProviderModels 的入参：override 与内建索引成组传入，避免参数膨胀 */
interface MapProviderModelsOptions {
  providerOv: ProviderOverride | undefined;
  builtinIndex: ReadonlyMap<string, BuiltinCompatSource> | undefined;
}

/** 按用户配置映射单个 provider 的模型列表（legacy 注册与原生 fetchModels 共用） */
function mapProviderModels(
  provider: RawProvider,
  resolved: ResolvedProvider,
  options: MapProviderModelsOptions,
): ProviderModelConfig[] {
  const rawList = Object.values(provider.models ?? {}).filter((m): m is RawModel => Boolean(m.id));
  const modelOvMap = options.providerOv?.models;
  return rawList
    .map((m) =>
      mapModel(m, resolved, {
        provider: options.providerOv,
        model: modelOvMap?.[m.id],
        builtinIndex: options.builtinIndex,
      }),
    )
    .filter((m): m is ProviderModelConfig => m !== null);
}

export default async function (pi: ExtensionAPI) {
  const registry = await fetchWithCache();
  if (!registry) {
    return;
  }

  // 用户配置：读取失败降级为无配置（D16，警告由 loadConfig 返回）
  const { config, warning } = loadConfig();
  if (warning) {
    console.error(`[models-dev] ${warning}`);
  }

  // Models.json 保护名单：显式声明的 provider 交还 pi 合成，扩展不注册
  // （优先级：配置文件 > models-dev 扩展 > pi 内置目录，2026-09-08）
  const { ids: protectedProviders, warning: modelsWarning } = loadCustomProviderIds();
  if (modelsWarning) {
    console.error(`[models-dev] ${modelsWarning}`);
  }

  // 内建 provider id 集合：重名者原生注册会顶层替换内建，分流回 legacy（见 native.ts）
  const builtinIds = new Set<string>(getBuiltinProviders());

  /** 内建重名 id 的 legacy 路径注册（与内建 base 合成，保留内建 auth/登录） */
  const registerLegacy = (options: {
    id: string;
    displayName: string;
    resolved: ResolvedProvider;
    models: ProviderModelConfig[];
    envVars: readonly string[];
  }): void => {
    const [envKey] = options.envVars;
    const apiKeyLiteral = envKey ? process.env[envKey] || undefined : undefined;
    pi.registerProvider(options.id, {
      name: options.displayName,
      ...(options.resolved.baseUrl ? { baseUrl: options.resolved.baseUrl } : {}),
      ...(apiKeyLiteral ? { apiKey: apiKeyLiteral } : {}),
      api: options.resolved.api,
      models: options.models,
    });
  };

  const nativeNames: string[] = [];
  const legacyNames: string[] = [];
  const skippedProtected: string[] = [];
  for (const [pid, provider] of Object.entries(registry)) {
    const providerOv = config?.providers?.[pid];

    // 配置文件优先：models.json 已声明的 provider 跳过，不覆写。
    // 代价：models-dev.json 对受保护 provider 的覆盖（disabled / api /
    // BaseUrl）随之失效，配置存在时打警告，避免无声漂移
    if (protectedProviders.has(pid)) {
      skippedProtected.push(pid);
      if (providerOv) {
        console.error(
          `[models-dev] provider ${pid} 在 models.json 已声明，models-dev.json 中的覆盖配置不生效（优先级：models.json > models-dev.json）`,
        );
      }
      continue;
    }

    // 配置过滤（Q5 黑名单）：provider 级 disabled 直接跳过
    if (providerOv?.disabled) {
      continue;
    }

    // 协议判定：未知 npm / 兼容系缺端点 → null；配置 api+baseUrl 双写可救活（Q6）
    let resolved: ResolvedProvider | null = resolveProviderApi(provider);
    if (!resolved) {
      if (providerOv?.api && providerOv?.baseUrl) {
        resolved = {
          api: providerOv.api,
          baseUrl: providerOv.baseUrl,
          isOpenAiFamily: isOpenAiFamilyApi(providerOv.api),
        };
      } else {
        continue;
      }
    } else {
      // 配置覆盖已判定者（单写 api 或 baseUrl 也生效）
      resolved = {
        api: providerOv?.api ?? resolved.api,
        baseUrl: providerOv?.baseUrl ?? resolved.baseUrl,
        isOpenAiFamily: resolved.isOpenAiFamily,
      };
    }

    const builtinIndex = builtinIds.has(pid)
      ? buildBuiltinCompatIndex(pid as BuiltinProvider)
      : undefined;
    const models = mapProviderModels(provider, resolved, { providerOv, builtinIndex });
    if (models.length === 0) {
      continue;
    }

    // ── 环境变量守卫：所有声明的 env var 必须存在且非空 ──
    // 被配置救活的 provider 不受此限（用户显式指定端点与协议，key 走 env[0] 或缺省）
    const envVars = provider.env ?? [];
    const missing = envVars.filter((e) => !process.env[e]);
    if (missing.length > 0 && !providerOv?.api) {
      continue;
    }

    const displayName = provider.name ?? pid;
    if (builtinIds.has(pid)) {
      // 内建重名：原生注册会顶层替换内建（丢 OAuth 与内建目录合成），保留 legacy
      registerLegacy({ id: pid, displayName, resolved, models, envVars });
      legacyNames.push(displayName);
      continue;
    }

    // 非重名：原生 Provider（auth / 刷新 / 持久化交给平台）
    const nativeProvider = buildNativeProvider({
      id: pid,
      name: displayName,
      baseUrl: resolved.baseUrl,
      envVars,
      models,
      fetchModels: async (context) => {
        const fresh = await fetchForRefresh({ force: context.force });
        const freshProvider = fresh?.[pid];
        if (!freshProvider) {
          return models; // 拉取失败：保持注册时列表
        }
        const refreshed = mapProviderModels(freshProvider, resolved, { providerOv, builtinIndex });
        return refreshed.length > 0 ? refreshed : models;
      },
    });
    if (nativeProvider) {
      pi.registerProvider(nativeProvider);
      nativeNames.push(displayName);
    } else {
      // 协议无可用 API 实现等异常：回退 legacy
      registerLegacy({ id: pid, displayName, resolved, models, envVars });
      legacyNames.push(displayName);
    }
  }

  // ── 启动后发一条汇总提示 ──
  if (nativeNames.length > 0 || legacyNames.length > 0 || skippedProtected.length > 0) {
    pi.on("session_start", async (event, ctx) => {
      if (event.reason === "startup") {
        const parts: string[] = [];
        if (nativeNames.length > 0) {
          parts.push(`原生 ${nativeNames.length}：${nativeNames.join(", ")}`);
        }
        if (legacyNames.length > 0) {
          parts.push(`legacy ${legacyNames.length}：${legacyNames.join(", ")}`);
        }
        const registeredNote =
          parts.length > 0
            ? `已注册 models.dev 提供商（${parts.join("；")}）`
            : "models.dev 未注册提供商";
        const skippedNote =
          skippedProtected.length > 0
            ? `；跳过 ${skippedProtected.length} 个 models.json 已声明：${skippedProtected.join(", ")}`
            : "";
        ctx.ui.notify(`${registeredNote}${skippedNote}`, "info");
      }
    });
  }
}
