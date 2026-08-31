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
 */

import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { fetchWithCache, type RawModel } from "./internal/registry.ts";
import { loadConfig } from "./internal/config.ts";
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

  const registeredNames: string[] = [];
  for (const [pid, provider] of Object.entries(registry)) {
    const providerOv = config?.providers?.[pid];

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
