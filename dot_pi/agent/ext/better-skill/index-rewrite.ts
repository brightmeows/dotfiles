/**
 * Skill Index Rewrite（better-skill 主模块，原 skill-index-rewrite.ts）
 *
 * 重写系统提示词中的技能索引段，并维护技能名空间。两层职责：
 *
 * 索引重写：移除 Pi 默认技能块（建议式激活指令 + XML 索引），换成指令式
 * 紧凑索引。Seleznov 650 次试验：建议式默认激活约五成，指令式 + 负向约束
 * + 偏向加载规则 100%，激活规则区全文保留（仅加载动作随工具化改写）。
 *
 * 索引格式（2026-09-01 主人确认定稿，替换原 XML 分组形态）：
 * - <available_skills> 容器保留（Agent Skills 标准的模型预训练锚点；R5
 *   移除断言只检查移除后的 base，新块复用同标签无自吞风险）
 * - 规则区 6 条：第 1 条加载动作改为“调用 skill 工具按名加载”（skill 工
 *   具为主通道，skill-tool.ts）；第 2-4 条原样；第 5 条去 SKILL.md 文件名
 *   绑定；第 6 条新增别名语义说明（防模型自行去后缀调到冲突的另一技能）
 * - 条目区：每技能一行 “- 名字: 描述”，按显示名字母序平铺，无分组无注
 *   释（Q2 纯平铺：group path 模板、来源仓库注释、项目级/全局级分隔注释
 *   全部废止——按名加载后路径模板失去意义，来源信息仍在 lock 文件可查）；
 *   description 全文保留不截断（Q3，激活可靠性优先），换行折叠为空格
 * - 条目名字列即可调用名：无冲突显示原名，重名消歧者显示别名（D13），
 *   模型照抄必可调用；名字解析走 internal/namespace.ts
 *
 * 名空间维护：before_agent_start 时调 ensureNamespace（diff 缓存，变化才
 * 全量预扫描，Q7）；消歧记录以 appendEntry 投递 TUI 通知（D12，不进 LLM
 * 上下文）；session_start（含 /reload）清缓存。加载动作与消歧通知的详细
 * 规则见 internal/namespace.ts 头注释。
 *
 * R5 默认块移除策略（原样保留）：措辞正则为主 + 纯标签兜底 + 断言守门，
 * 抗 Pi 版本措辞漂移，杜绝“默认块残留 + 新块 = 重复”，见下方正则注释。
 *
 * 退役记录（2026-09-01）：internal/render.ts（XML 条目渲染）、internal/
 * source-labels.ts（来源标签，消费方为已废止的来源注释）、internal/
 * path-canon.ts 的规范化/分组/收集函数（消费方为已废止的分组渲染）随之
 * 删除；path-canon.ts 仅存 expandHome（read 拦截消费）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderInjectEntry, renderInjectNotice } from "./internal/inject-notice.ts";
import { ensureNamespace, resetNamespaceCache, resolveDisplayName } from "./internal/namespace.ts";

/** 技能索引条目所需的最小结构（Pi Skill 类型的子集，避免依赖其类型导出） */
interface SkillIndexEntry {
  name: string;
  description?: string;
  filePath: string;
  disableModelInvocation?: boolean;
}

/**
 * Pi 默认技能索引块的移除策略（R5：措辞精确为主，标签兜底，断言守门）。
 *
 * formatSkillsForPrompt（pi skills.js）产出的默认块 = 前导说明文字
 * （建议式激活指令，3 行英文）+ <available_skills>…</available_skills>。
 * 本扩展要整体移除它，换成自己的指令式索引。
 *
 * PI_INTRO_BLOCK_RE（主）：锚定前导措辞 “The following skills…”，精确
 *   吃掉“说明 + 标签”整段。措辞随 Pi 版本可能变，失配时降级到兜底。
 * PI_TAGS_BLOCK_RE（兜底）：纯 <available_skills> 标签锚点，结构稳定
 *   （XML 标签名遵 Agent Skills 标准），保证标签块必被移除，杜绝“默认块
 *   残留 + 新块 = 重复”。代价：只吃标签块，遗留前导说明（冗余不致命）。
 *
 * 不用“标签 + 向前回溯吃说明段”：会把标签前最近的无空行段落误当说明吞掉
 * （误伤 prompt 合法内容），实测否决。断言兜底：两层都没吃掉标签块时告警。
 */
const PI_INTRO_BLOCK_RE =
  /\n\nThe following skills provide specialized instructions[\s\S]*?<\/available_skills>/;
const PI_TAGS_BLOCK_RE = /<available_skills>[\s\S]*?<\/available_skills>/;

/** description 换行折叠为单个空格（一行式条目保行结构，D3） */
function collapseDescription(d: string): string {
  return d.replace(/\s*\n\s*/g, " ").trim();
}

export function registerIndexRewrite(pi: ExtensionAPI) {
  // 统一渲染（默认外观，collapsed 只显示注入提示）
  pi.registerMessageRenderer("better-skill", renderInjectNotice);
  // read-hint / skill-tool 的 TUI-only 简短提示（appendEntry，不进 LLM
  // 上下文；entry 与 message 的 customType 体系独立）
  pi.registerEntryRenderer("better-skill", renderInjectEntry);

  // 断言告警去重（compact 后重置）：默认块没被两层正则移除时，首轮告警一次
  let assertNotified = false;
  pi.on("session_compact", async () => {
    assertNotified = false;
  });
  // 名空间缓存随会话生命周期重建（/reload 后技能集合可能变化）
  pi.on("session_start", async () => {
    resetNamespaceCache();
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const allSkills = (event.systemPromptOptions.skills ?? []) as SkillIndexEntry[];
    const skills = allSkills.filter((s) => !s.disableModelInvocation);

    // 名空间就绪（先于索引渲染与 skill 工具消费；空集合也重建，卸载全部
    // 技能后映射同步清空）；消歧记录投递 TUI 通知，主人可改名根治
    const { conflicts } = ensureNamespace(skills, ctx.cwd);
    for (const c of conflicts) {
      pi.appendEntry("better-skill", {
        notice: `[自动注入] 技能名冲突：${c.name} 同时存在于 ${c.winnerDir} 与 ${c.loserDir}，后者消歧为 ${c.alias}`,
      });
    }

    if (skills.length === 0) {
      return;
    }

    // R5：措辞正则优先（精确移除“说明+标签”整段），失配则纯标签兜底（至少移除标签块）
    const introMatched = PI_INTRO_BLOCK_RE.test(event.systemPrompt);
    const base = introMatched
      ? event.systemPrompt.replace(PI_INTRO_BLOCK_RE, "")
      : event.systemPrompt.replace(PI_TAGS_BLOCK_RE, "");
    // 断言：两层正则之一应已移除默认标签块；若仍残留，Pi 大改结构，告警人工介入
    if (!assertNotified && PI_TAGS_BLOCK_RE.test(base)) {
      assertNotified = true;
      pi.sendMessage(
        {
          customType: "better-skill",
          content: "[自动注入] 技能索引：默认技能块移除失败，检查 index-rewrite.ts 正则",
          details: { notice: "better-skill 默认块移除断言失败" },
          display: true,
        },
        { deliverAs: "steer" },
      );
    }

    // 索引段（2026-09-01 定稿文本）：规则区 6 条 + 空行 + 平铺条目
    const lines: string[] = [
      "",
      "<available_skills>",
      "可用技能。激活规则（强制）：",
      "- 任何任务，只要与某技能描述部分相关，MUST 先调用 skill 工具按名加载该技能，再开始工作。",
      "- 宁可多加载一个不需要的，也不要漏掉关键步骤；加载错的代价远小于漏掉的代价。",
      "- 这些技能含 API 端点、命令等预训练知识里没有的专有内容；即便觉得能用通用工具完成，也要先加载。",
      "- 只有确认无任何技能相关，才可不加载。",
      "- 技能加载后，若其内容引用 references/scripts 等相对路径文件，以该技能目录为基准解析路径后一并读取，不要跳过。",
      "- 技能名全局唯一。名字含 @ 的是重名消歧别名（原名@宿主标识），照抄调用，不要去掉后缀。",
      "",
    ];
    // 按显示名（可调用名）字母序平铺（D5/D13）：无冲突显示原名，消歧者
    // 显示别名，照抄必可调用
    const entries = [...skills].sort((a, b) => {
      const da = resolveDisplayName(a.filePath, a.name);
      const db = resolveDisplayName(b.filePath, b.name);
      return da.localeCompare(db);
    });
    for (const s of entries) {
      const display = resolveDisplayName(s.filePath, s.name);
      lines.push(`- ${display}${s.description ? `: ${collapseDescription(s.description)}` : ""}`);
    }
    lines.push("</available_skills>");

    return { systemPrompt: `${base}\n\n${lines.join("\n")}` };
  });
}
