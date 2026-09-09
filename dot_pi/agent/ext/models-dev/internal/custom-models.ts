/**
 * 读 models.json 自定义 provider 名单（custom-models 子模块）
 *
 * 职责：读取 ~/.pi/agent/models.json（pi 官方自定义模型文件，chezmoi 从
 * dot_pi/agent/models.json 直接部署）的顶层 providers 键集合。该文件由 pi
 * 原生消费，models.json overrides 合成在已注册 provider 之上；本扩展若再
 * 注册同名 provider，registerProvider 带 models 会整体替换 pi 已合成的
 * 模型列表，使 models.json 的显式定义失效（2026-09-08 实测：models.json
 * 定义 opencode-go 的 my-custom-model，最终列表被扩展的 models.dev 数据
 * 完全覆盖）。修复：扩展注册前跳过名单内 provider，让 pi 的合成语义
 * （内置目录模型保留 + models.json upsert/替换）生效，达成优先级
 * “配置文件 models.json > models-dev 扩展 > pi 内置目录”。
 *
 * 失效模式：文件不存在 → 空名单（无保护，行为与历史一致）；providers 键
 * 缺失 → 空名单（文件存在但未声明自定义模型，正常路径）；JSON 语法错或
 * providers 非对象（数组/标量）→ 警告 + 空名单，不崩溃（对齐 config.ts
 * 的 D16 降级）。
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MODELS_FILE = join(homedir(), ".pi", "agent", "models.json");

export interface LoadCustomProvidersResult {
  /** 受保护 provider id 集合（models.json 顶层声明过）；异常路径为空集 */
  ids: Set<string>;
  /** 文件存在但结构损坏（语法错 / providers 非对象）时的警告文案（调用方打日志用） */
  warning?: string;
}

/** 读取并解析 models.json；一切失败路径都返回空名单 + 可选警告，不抛错 */
export function loadCustomProviderIds(): LoadCustomProvidersResult {
  let raw: string;
  try {
    raw = readFileSync(MODELS_FILE, "utf8");
  } catch {
    // 文件不存在：无自定义模型，正常路径
    return { ids: new Set() };
  }
  try {
    const data = JSON.parse(raw) as { providers?: unknown };
    const providers = data?.providers;
    if (providers === undefined || providers === null) {
      // 无 providers 键：文件存在但未声明自定义模型，正常路径
      return { ids: new Set() };
    }
    if (typeof providers !== "object" || Array.isArray(providers)) {
      // 当 providers 为数组或标量（非对象）：结构损坏，按无名单降级并警告
      const kind = Array.isArray(providers) ? "array" : typeof providers;
      return {
        ids: new Set(),
        warning: `models.json providers 非对象（${kind}），models-dev 不设保护名单`,
      };
    }
    return { ids: new Set(Object.keys(providers)) };
  } catch (error) {
    return {
      ids: new Set(),
      warning: `models.json 解析失败，models-dev 不设保护名单：${error instanceof Error ? error.message : error}`,
    };
  }
}
