/**
 * 模型目录导入域扩展合并入口（models-dev）
 *
 * Pi 扩展发现只支持一层子目录 + 单一入口（index.ts），本目录收纳 models.dev
 * provider 注册表导入：
 * - registry.ts：拉取与缓存（models.dev/api.json，24h TTL）
 * - config.ts：用户配置读取与校验（~/.pi/agent/models-dev.json，chezmoi 维护）
 * - mapping.ts：协议判定（npm→api 映射 + 模型层 shape/api 覆盖）与模型映射
 * - thinking.ts：思考挡位映射（pi 层级含 max）
 *
 * 编排（async factory，入口 await 保证顺序）：读配置 → 遍历 provider →
 * 配置过滤（disabled）→ 协议判定 → 配置救活/覆盖 → 模型映射（含模型级
 * disabled 过滤）→ env 守卫 → 注册。
 *
 * 目录组织（2026-08-27 拆包）：由 tools/ 拆出独立成域并做协议感知改造；
 * 同日接入用户配置（黑名单过滤 / 协议端点覆盖 / 救活被跳过 provider）。
 *
 * 优先级（2026-09-08 修订）：配置文件 models.json > models-dev 扩展 > pi 内置
 * 目录。models.json 显式声明的 provider 进入保护名单，扩展跳过注册，避免
 * registerProvider 带 models 整体替换 pi 已合成的模型列表（覆盖自定义）。
 */

import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { fetchWithCache, type RawModel } from "./internal/registry.ts";
import { loadConfig } from "./internal/config.ts";
import { loadCustomProviderIds } from "./internal/custom-models.ts";
import {
  isOpenAiFamilyApi,
  mapModel,
  resolveProviderApi,
  type ResolvedProvider,
} from "./internal/mapping.ts";

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

  const registeredNames: string[] = [];
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

    if (!provider.models) {
      continue;
    }
    const rawList = Object.values(provider.models).filter((m): m is RawModel => Boolean(m.id));
    if (rawList.length === 0) {
      continue;
    }

    const modelOvMap = providerOv?.models;
    const models = rawList
      .map((m) => mapModel(m, resolved, { provider: providerOv, model: modelOvMap?.[m.id] }))
      .filter((m): m is ProviderModelConfig => m !== null);
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

    const envKey = provider.env?.[0];
    const apiKeyLiteral = envKey ? process.env[envKey] || undefined : undefined;
    pi.registerProvider(pid, {
      name: provider.name ?? pid,
      ...(resolved.baseUrl ? { baseUrl: resolved.baseUrl } : {}),
      ...(apiKeyLiteral ? { apiKey: apiKeyLiteral } : {}),
      api: resolved.api,
      models,
    });
    registeredNames.push(provider.name ?? pid);
  }

  // ── 启动后发一条汇总提示 ──
  if (registeredNames.length > 0 || skippedProtected.length > 0) {
    pi.on("session_start", async (event, ctx) => {
      if (event.reason === "startup") {
        const skippedNote =
          skippedProtected.length > 0
            ? `；跳过 ${skippedProtected.length} 个 models.json 已声明：${skippedProtected.join(", ")}`
            : "";
        ctx.ui.notify(
          `已注册 ${registeredNames.length} 个 models.dev 提供商：${registeredNames.join(", ")}${skippedNote}`,
          "info",
        );
      }
    });
  }
}
