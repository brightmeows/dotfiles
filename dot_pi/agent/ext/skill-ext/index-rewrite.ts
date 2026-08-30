/**
 * Skill Index Rewrite（skill-ext 主模块，原 skill-index-rewrite.ts）
 *
 * 重写系统提示词中的技能索引段，解决技能激活可靠性 + 组织清晰度：
 * - 移除 Pi 默认建议式激活指令（Seleznov 650 次试验：建议式默认激活
 *   约五成），改为指令式 + 负向约束 + 偏向加载规则（同试验 100%）。
 * - 默认块移除走 R5 策略（措辞精确为主 + 纯标签兜底 + 断言守门），抗 Pi
 *   版本措辞漂移，杜绝“默认块残留 + 新块 = 重复”，详见下方正则注释。
 * - 不做关键词检索凸显（token 重叠粗糙、易误判）；所有技能统一按
 *   安装来源仓库（~/.agents/.skill-lock.json + 项目 skills-lock.json）排序，
 *   模型自行按 description 判断加载。
 *
 * 格式（纯 XML，路径模板零歧义设计）：
 * - <group path="..."> path 为完整路径模板（如 ~/.agents/skills/${name}/SKILL.md），
 *   用 <name> 替换 ${name} 即得 SKILL.md 完整路径，无需拼接推断。
 * - 同一安装仓库的技能以 <!-- 来源仓库: ... --> 注释分段；注释是纯标注，
 *   不属于任何元素。注释内容为 host/owner/repo 形态（如
 *   github.com/larksuite/cli），域名打头不可能与本地路径混淆。
 * - skill 只含 name+description，路径由 group path 模板给出。
 * - 组边界以 <!-- ===== 项目级技能 ===== --> / <!-- ===== 全局技能 ===== -->
 *   分隔注释标注级别（纯标注，不影响加载规则）；某级无技能时不插对应注释。
 * - 项目级判定：技能组目录位于 cwd 下（cwd 前缀，覆盖 --skill/settings 任意
 *   路径形态）或位于祖先链 .agents/skills / cwd 的 .pi/skills 白名单（并集，
 *   防 Pi 恢复默认项目扫描时漏判）；其余归全局。
 *
 * 不改 Pi 源码、不改技能文件；信息完整保留（name+description）。
 *
 * 辅助模块（本目录内，2026-08-11 拆分）：
 * - source-labels.ts：技能来源标签解析（lock → host/owner/repo）
 * - path-canon.ts：展示路径规范化与项目技能目录收集
 * - render.ts：技能索引 XML 渲染
 *
 * 用户提示（2026-08-12 引入知情投递，2026-08-17 移除）：常规重写不再投递
 * 任何提示（对用户与 LLM 均为杂讯）；仅断言告警保留（错误信号非杂讯），
 * 渲染仍走包内 inject-notice.ts 的 renderInjectNotice（默认外观）。
 * 另：本模块作为 skill-ext 族主模块，统一注册族内 appendEntry 的
 * entry renderer（ref-hint / subskill-hint 的 TUI-only 简短提示消费）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sep } from "node:path";
import { renderInjectEntry, renderInjectNotice } from "./inject-notice.ts";
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
  renderGroupOpen,
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
  // Ref-hint / subskill-hint 的 TUI-only 简短提示（appendEntry，不进 LLM
  // 上下文；entry 与 message 的 customType 体系独立）
  pi.registerEntryRenderer("skill-ext", renderInjectEntry);

  // 断言告警去重（compact 后重置）：默认块没被两层正则移除时，首轮告警一次
  let assertNotified = false;
  pi.on("session_compact", async () => {
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
      "- 加载 SKILL.md 后，若它引用 references/scripts 等相对路径文件，以 SKILL.md 所在目录为基准解析路径后一并读取，不要跳过。",
    ];

    // 按 dir → origin 嵌套排序，扁平渲染（group 下按 source 注释分段，skill 无 origin 属性）
    // 项目级目录组（cwd 内 / 祖先 .agents/skills）优先于全局；同级别内
    // .agents/skills 组先于 .pi/skills 组，再按数量降序
    const isProjectDir = (dg: string) =>
      dg === ctx.cwd ||
      dg.startsWith(`${ctx.cwd}${sep}`) ||
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
    // 组边界插级别分隔注释（纯标注）：项目级组（cwd/祖先链）在前，全局组
    // 在后；排序已保证同级别连续，仅边界切换时插入，某级无技能时不插
    const PROJECT_SECTION_COMMENT = "<!-- ===== 项目级技能 ===== -->";
    const GLOBAL_SECTION_COMMENT = "<!-- ===== 全局技能 ===== -->";
    let prevIsProject: boolean | null = null;
    for (const [dg, originGroup] of dirEntries) {
      const isProject = isProjectDir(dg);
      if (prevIsProject !== isProject) {
        lines.push(isProject ? PROJECT_SECTION_COMMENT : GLOBAL_SECTION_COMMENT);
        prevIsProject = isProject;
      }
      lines.push(renderGroupOpen(`${shortenHome(dg)}/\${name}/SKILL.md`));
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

    return { systemPrompt: `${base}\n\n${lines.join("\n")}` };
  });
}
