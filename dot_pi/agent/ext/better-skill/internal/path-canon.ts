/**
 * 路径工具（better-skill 包内纯库）
 *
 * 历史职责（展示路径规范化、项目技能目录收集、分组键、home 缩短）已于
 * 2026-09-01 随索引一行式改造退役——分组渲染与路径模板废止后消费方消失；
 * 目录分类与消歧宿主标识派生迁往 internal/namespace.ts。现仅存 ~ 前缀
 * 展开。
 */

import { homedir } from "node:os";
import { join } from "node:path";

/** ~ 前缀展开：技能路径以 ~ 形式展示时模型可能照抄该形式发起 read，而
 * node fs 不展开 ~（openSync/readdirSync 直接 ENOENT）；tool_result 拦截
 * 类模块在 fs 调用前展开 */
export function expandHome(p: string): string {
  if (p === "~") {
    return homedir();
  }
  if (p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}
