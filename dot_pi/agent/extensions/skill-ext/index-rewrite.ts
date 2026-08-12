/**
 * Skill Index Rewrite（skill-ext 主模块，原 skill-index-rewrite.ts）
 *
 * 重写系统提示词中的技能索引段，解决技能激活可靠性 + 组织清晰度：
 * - 移除 Pi 默认建议式激活指令（Seleznov 650 次试验激活率 77%），改为
 *   指令式 + 负向约束 + 偏向加载规则（同试验 100%）。
 * - 默认块移除走 R5 策略（措辞精确为主 + 纯标签兜底 + 断言守门），抗 Pi
 *   版本措辞漂移，杜绝“默认块残留 + 新块 = 重复”，详见下方正则注释。
 * - 不做关键词检索凸显（token 重叠粗糙、易误判）；所有技能统一按
 *   安装来源仓库（~/.agents/.skill-lock.json + 项目 skills-lock.json）排序，
 *   模型自行按 description 判断加载。
 *
 * 格式（纯 XML，路径零歧义设计）：
 * - <group dir="..."> 标注 skills 目录（dir 明确是目录，非完整路径）。
 * - 同一安装仓库的技能以 <!-- 来源仓库: ... --> 注释分段；注释是纯标注，
 *   不属于任何元素。注释内容为 host/owner/repo 形态（如
 *   github.com/larksuite/cli），域名打头不可能与本地路径混淆。
 * - skill 只含 name+description；路径 = <group dir>/<skill name>/SKILL.md，
 *   路径链只有 group→skill 两层，推断无歧义。
 *
 * 不改 Pi 源码、不改技能文件；信息完整保留（name+description）。
 *
 * 辅助模块（本目录内，2026-08-11 拆分）：
 * - source-labels.ts：技能来源标签解析（lock → host/owner/repo）
 * - path-canon.ts：展示路径规范化与项目技能目录收集
 * - render.ts：技能索引 XML 渲染
 *
 * 用户知情（2026-08-12）：首轮改写时投递一条 custom_message 通知
 * （display:true），TUI 渲染统一走 ../lib/inject-notice.ts 的
 * renderInjectNotice（默认外观，只显示提示）；compact 后重置可再次提示。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sep } from "node:path";
import { renderInjectNotice } from "../lib/inject-notice.ts";
import {
  LOCAL_LABEL,
  UNKNOWN_LABEL,
  loadProjectSourceMap,
  loadSourceMap,
} from "./source-labels.ts";
import {
  CANONICAL_USER_DIRS,
  canonicalSkillFilePath,
  collectProjectSkillDirs,
  pathGroupKey,
  shortenHome,
} from "./path-canon.ts";
import {
  countGroup,
  escapeXml,
  renderSkill,
  sanitizeComment,
  type SkillIndexEntry,
} from "./render.ts";

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

export function registerIndexRewrite(pi: ExtensionAPI) {
  // 统一渲染（默认外观，collapsed 只显示注入提示）
  pi.registerMessageRenderer("skill-ext", renderInjectNotice);

  // 首轮是否已投递知情提示（compact 后重置，允许重新提示）
  let notified = false;
  // 断言告警去重（compact 后重置）：默认块没被两层正则移除时，首轮告警一次
  let assertNotified = false;
  pi.on("session_compact", async () => {
    notified = false;
    assertNotified = false;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const allSkills = (event.systemPromptOptions.skills ?? []) as SkillIndexEntry[];
    const skills = allSkills.filter((s) => !s.disableModelInvocation);
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
          customType: "skill-ext",
          content:
            "[自动注入] 技能索引：警告——未能移除 Pi 默认技能块（两层正则均失配，疑似 Pi 结构变更），可能出现重复块，请检查 index-rewrite.ts 正则",
          details: { notice: "skill-ext 默认块移除断言失败" },
          display: true,
        },
        { deliverAs: "steer" },
      );
    }
    const projectDirs = collectProjectSkillDirs(ctx.cwd);
    const canonDirs = [...projectDirs.canon, ...CANONICAL_USER_DIRS];
    const { map: globalMap, ok: globalOk } = loadSourceMap();
    // 项目 lock 优先于全局 lock（就近优先，与 AGENTS.md 层级语义一致）
    const projectMap = loadProjectSourceMap(ctx.cwd);
    const sourceMap = new Map([...globalMap, ...projectMap]);
    const lockOk = globalOk || projectMap.size > 0;

    // 按 dir → origin 双层分组（用于排序，渲染时扁平——不嵌套 origin 标签）
    const dirMap = new Map<string, Map<string, SkillIndexEntry[]>>();
    for (const skill of skills) {
      const dg = pathGroupKey(canonicalSkillFilePath(skill.filePath, canonDirs));
      let originGroup = dirMap.get(dg);
      if (!originGroup) {
        originGroup = new Map();
        dirMap.set(dg, originGroup);
      }
      const og = lockOk ? (sourceMap.get(skill.name) ?? LOCAL_LABEL) : UNKNOWN_LABEL;
      let arr = originGroup.get(og);
      if (!arr) {
        arr = [];
        originGroup.set(og, arr);
      }
      arr.push(skill);
    }

    const lines: string[] = [
      "",
      "<available_skills>",
      "可用技能。激活规则（强制）：",
      "- 任何任务，只要与某技能描述部分相关，MUST 先用 read 加载该 SKILL.md，再开始工作。",
      "- 宁可多加载一个不需要的，也不要漏掉关键步骤；加载错的代价远小于漏掉的代价。",
      "- 这些技能含 API 端点、命令等预训练知识里没有的专有内容；即便觉得能用通用工具完成，也要先加载。",
      "- 只有确认无任何技能相关，才可不加载。",
      "- 技能 SKILL.md 路径 = <group dir>/<skill name>/SKILL.md，加载时按此拼路径 read。",
      "- 加载 SKILL.md 后，若它引用 references/scripts 等相对路径文件，按指引一并读取，不要跳过。",
    ];

    // 按 dir → origin 嵌套排序，扁平渲染（group 下按 source 注释分段，skill 无 origin 属性）
    // 项目级目录组（.pi/skills、祖先 .agents/skills）优先于全局；同级别内
    // .agents/skills 组先于 .pi/skills 组，再按数量降序
    const isProjectDir = (dg: string) =>
      projectDirs.sort.some((p) => dg === p || dg.startsWith(`${p}${sep}`));
    const isAgentsDir = (dg: string) => canonDirs.includes(dg);
    // eslint-disable-next-line unicorn/no-array-sort -- [...展开] 已是新数组，sort 安全
    const dirEntries = [...dirMap.entries()].sort(
      (a, b) =>
        Number(isProjectDir(b[0])) - Number(isProjectDir(a[0])) ||
        Number(isAgentsDir(b[0])) - Number(isAgentsDir(a[0])) ||
        countGroup(b[1]) - countGroup(a[1]) ||
        a[0].localeCompare(b[0]),
    );
    for (const [dg, originGroup] of dirEntries) {
      lines.push(`<group dir="${escapeXml(shortenHome(dg))}/">`);
      // eslint-disable-next-line unicorn/no-array-sort -- [...展开] 已是新数组，sort 安全
      const originEntries = [...originGroup.entries()].sort(
        (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
      );
      for (const [og, groupSkills] of originEntries) {
        lines.push(`  <!-- 来源仓库: ${sanitizeComment(og)} -->`);
        for (const skill of groupSkills) {
          lines.push(...renderSkill(skill));
        }
      }
      lines.push(`</group>`);
    }

    lines.push("</available_skills>");

    // 首轮用户知情提示（不重复全文，只告知重写事实）
    if (!notified) {
      notified = true;
      const notice = `[自动注入] 技能索引：已重写 ${skills.length} 个技能条目的激活规则`;
      pi.sendMessage(
        {
          customType: "skill-ext",
          content: notice,
          details: { notice },
          display: true,
        },
        { deliverAs: "steer" },
      );
    }

    return { systemPrompt: `${base}\n\n${lines.join("\n")}` };
  });
}
