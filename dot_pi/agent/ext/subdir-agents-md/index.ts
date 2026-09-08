/**
 * Subdirectory AGENTS.md Extension
 *
 * 懒加载子目录规则文件：LLM 访问某路径时，按需发现并将“管辖”该路径的
 * 子目录规则文件内容直接注入上下文（Pi 默认只向上加载，不向下递归；上游
 * #4834 已确认不进核心，扩展是官方认可的实现位置，用户消息通道注入不伤
 * provider 端 prompt cache）。
 *
 * 设计要点（2026-09-08 重构）：
 * - 触发：tool_call 时提取被访问路径。结构化工具（read/edit/write）直接取
 *   input.path；bash 不再用“命令白名单 + 首操作数”正则（对 rg/grep 等
 *   模式优先命令会把模式当路径、fd 等未白名单命令完全失配、带独立值的
 *   flag 会把值当路径——旧版触发不稳定的主因），改为 internal/path-extract.ts
 *   的全 token 扫描 + 存在性过滤：shell 词法切分整条命令，丢弃 flag 与纯
 *   数字，保留含 / 的 token 与磁盘真实存在的 token。业界同款功能（opencode
 *   v2、Claude Code、pi-subdir-context）均只信结构化路径、不解析 shell
 *   文本；bash 通道是本扩展超出业界基线的增强，存在性过滤把不确定性压到
 *   “几次多余的 stat 调用”量级。
 * - 锚点与查找：文件路径算锚点目录（所在目录 + 去扩展名 co-located 目录，
 *   如 src/memory.rs → src 与 src/memory），向上逐目录选定规则文件
 *   （AGENTS.override.md > AGENTS.md > CLAUDE.md，override 语义同 Pi 核心
 *   启动加载），止于 cwd（不含：根规则文件由 Pi 原生加载）。路径统一展开
 *   ~ 前缀并 realpath 归一（symlink 指向 cwd 外时放弃注入）。
 * - 启动索引：session_start 用纯 node:fs 受限 BFS 扫描（限深 4、限 32 个、
 *   跳过 node_modules/.git 与 symlink 目录；不用 fd 等外部命令、零 npm
 *   运行时依赖——本地包经 chezmoi copy 分发，部署区无 node_modules，npm
 *   依赖在运行时无法解析），首个 context 事件注入一行一条的索引
 *   custom_message，让模型始终知道哪些子树有规则可依（懒触发失灵的兜底）。
 *   每会话一次，compact 后重注入。
 * - 注入（custom_message + steer）：context 事件对未注入的规则文件用
 *   pi.sendMessage 投递 custom_message（display:true），完整内容下一轮进
 *   LLM context；TUI 渲染统一走包内 inject-notice.ts 的 renderInjectNotice
 *   （复刻默认 custom_message 外观：collapsed 只显示“已注入”提示，ctrl+o
 *   展开后显示注入全文；display 只控 TUI 渲染，content 总进 LLM）。
 * - 去重靠查找（buildContextEntries）：用 compact-aware 的 buildContextEntries
 *   查找已注入的 customType（固定值）+ details.rel（同文件去重，旧格式回退
 *   customType 后缀）与 details.hash（同内容多子包去重）；命中则跳过，
 *   compact 压缩后查不到则重新注入。哈希存 custom_message 的 details（不进
 *   LLM）。代理用 read 显式读取过的规则文件（explicitlyRead 集合，含
 *   override/CLAUDE 命名）亦跳过——内容已作为 tool_result 进 LLM；compact
 *   后清空允许重注入。
 *
 * 规则：仅注入 cwd 严格子目录（根规则文件由 Pi 原生加载）；不截断、
 * 不做 git-ignore 过滤。
 *
 * 目录组织：一包一扩展（2026-08-30 拆包），index.ts 为包入口；纯路径/命令
 * 解析与索引扫描归 internal/path-extract.ts（可用 node 独立测试）；TUI
 * 渲染为包内副本 inject-notice.ts。
 */

import type { CustomMessageEntry, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { renderInjectNotice } from "./inject-notice.ts";
import {
  anchorDirs,
  bashPathCandidates,
  expandHome,
  findAncestorContextFiles,
  isContextFilename,
  pickContextFile,
  realpathOr,
  scanContextFiles,
} from "./internal/path-extract.ts";

/** 注入消息的固定 customType（去重键 + TUI 渲染查找键，标签即默认外观的 [customType]） */
const CUSTOM_TYPE = "subdir-agents-md";

/** 启动索引消息的 details.rel（去重键；非真实路径，不与规则文件 rel 冲突） */
const INDEX_REL = ".subdir-agents-index";

/** 索引扫描边界：深度按路径段计（dot_pi/agent/ext/AGENTS.md 为 4），文件数为软上限 */
const INDEX_MAX_DEPTH = 4;
const INDEX_MAX_FILES = 32;

// ── 注入提示文案 ──

/** 懒注入提示（统一格式 [自动注入] <来源>：<说明>；collapsed 显示，expanded 显示全文） */
const injectNotice = (rel: string): string => `[自动注入] ./${rel}：子目录规则已注入`;

// ── 内容哈希（品牌类型，同内容多子包去重） ──

/** SHA256 十六进制摘要的品牌类型；仅由 hashOf 构造，禁止任意字符串冒充 */
type Hash = string & { readonly __brand: "Hash" };

/** 计算内容的 sha256 摘要（唯一构造 Hash 的入口） */
function hashOf(content: string): Hash {
  return createHash("sha256").update(content).digest("hex") as Hash;
}

// ── 路径提取 ──

/**
 * 从工具调用参数提取被访问路径（相对 root；~ 展开与 realpath 归一后）。
 * 结构化工具取 input.path；bash 整条命令交 bashPathCandidates 全 token 扫描。
 * 返回空数组表示无可提取路径；root 外（含 symlink 逃逸）丢弃。
 */
function extractAccessedPaths(
  toolName: string,
  input: Record<string, unknown> | undefined | null,
  root: string,
): string[] {
  if (!input) {
    return [];
  }

  if (toolName === "bash") {
    const cmd = input["command"];
    return typeof cmd === "string" ? bashPathCandidates(cmd, root) : [];
  }

  const p = input["path"];
  if (typeof p !== "string" || p.length === 0) {
    return [];
  }
  const resolved = realpathOr(path.resolve(root, expandHome(p)));
  const rel = path.relative(root, resolved);
  if (rel === "" || rel === ".." || rel.startsWith("../") || path.isAbsolute(rel)) {
    return [];
  }
  return [rel];
}

// ── 内容读取 ──

/** 读取文件内容（读取失败返回 null，调用方据此跳过并允许下次重试） */
function readContent(absPath: string): string | null {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

// ── 启动索引 ──

/**
 * 每目录按优先级选定一个规则文件后返回排序的相对路径列表（override >
 * AGENTS.md > CLAUDE.md）。
 */
function selectIndexFiles(root: string, files: string[]): string[] {
  const dirs = new Set(files.map((rel) => path.dirname(path.resolve(root, rel))));
  const picked: string[] = [];
  for (const dir of dirs) {
    const file = pickContextFile(dir);
    if (file) {
      picked.push(path.relative(root, file));
    }
  }
  return picked.sort();
}

// ── Extension ──

export default function subdirAgentsMdExtension(pi: ExtensionAPI) {
  // 统一渲染（复刻默认 custom_message 外观：collapsed 提示 / expanded 全文）
  pi.registerMessageRenderer(CUSTOM_TYPE, renderInjectNotice);

  /** 待处理的相对路径（tool_call 收集，context 消费；Set 自动去重） */
  const pending = new Set<string>();
  /** 代理用 read 显式读取过的规则文件相对路径（compact 后清空，允许重注入） */
  const explicitlyRead = new Set<string>();
  /** 启动索引是否已投递（compact 后清空允许重注入；resume 场景另靠 rel 去重挡） */
  let indexInjected = false;
  /** 索引扫描结果（session_start 发起，首个 context 消费） */
  let indexFiles: string[] | null = null;

  pi.on("session_start", async (_event, ctx) => {
    indexFiles = scanContextFiles(realpathOr(ctx.cwd), INDEX_MAX_DEPTH, INDEX_MAX_FILES);
  });

  // 工具调用时按访问路径发现待注入的规则文件（仅收集相对路径，不读内容）
  pi.on("tool_call", async (event, ctx) => {
    const root = realpathOr(ctx.cwd);
    const accessed = extractAccessedPaths(event.toolName, event.input, root);
    if (accessed.length === 0) {
      return;
    }

    // 代理用 read 显式读取了规则文件本身 → 标记，context 阶段跳过注入：
    // 内容已作为 tool_result 进 LLM，重复注入纯浪费 token。仅限 read 工具——
    // Bash cat 等场景少，且 token 扫描难区分“读全文”与“列目录”
    if (event.toolName === "read") {
      for (const rel of accessed) {
        if (isContextFilename(path.basename(rel))) {
          explicitlyRead.add(rel);
        }
      }
    }

    for (const rel of accessed) {
      for (const anchor of anchorDirs(path.resolve(root, rel))) {
        for (const found of findAncestorContextFiles(anchor, root)) {
          pending.add(found);
        }
      }
    }
  });

  // 下一轮 LLM 调用前：查找去重，未注入的用 custom_message 投递（steer）
  pi.on("context", async (_event, ctx) => {
    const toProcess = [...pending];
    pending.clear();
    if (toProcess.length === 0 && (indexInjected || !indexFiles)) {
      return;
    }

    const root = realpathOr(ctx.cwd);

    // 查找当前上下文里已注入的规则文件（compact-aware：原内容被压缩后不再
    // 返回，自然允许重新注入）
    const existing = ctx.sessionManager
      .buildContextEntries()
      .filter(
        (e): e is CustomMessageEntry =>
          e.type === "custom_message" &&
          (e.customType === CUSTOM_TYPE || e.customType.startsWith(`${CUSTOM_TYPE}:`)),
      );
    const inContextRels = new Set(
      existing
        .map((e) => {
          // 旧格式兼容（2026-08-12 前）：customType 带 rel 后缀（subdir-agents-md:./x）
          const rel = (e.details as { rel?: string } | undefined)?.rel;
          if (rel !== undefined) {
            return rel;
          }
          return e.customType.startsWith(`${CUSTOM_TYPE}:`)
            ? e.customType.slice(CUSTOM_TYPE.length + 1)
            : undefined;
        })
        .filter((r): r is string => r !== undefined),
    );
    const inContextHashes = new Set(
      existing
        .map((e) => (e.details as { hash?: string } | undefined)?.hash)
        .filter((h): h is string => typeof h === "string"),
    );

    // 同 turn 内已投递的哈希（steer 延迟到下 turn drain，本 turn 多个 pending 靠它去重）
    const seenHashes = new Set<string>();

    // 启动索引：每会话一次；compact 后重注入；resume 时旧条目仍在上下文，
    // 靠 rel 去重挡
    if (indexFiles && !indexInjected && !inContextRels.has(INDEX_REL)) {
      const subFiles = indexFiles.filter((rel) => rel.includes(path.sep));
      const files = selectIndexFiles(root, subFiles);
      if (files.length > 0) {
        const notice = `[自动注入] 子目录规则索引：${files.length} 个子目录有规则文件`;
        const content = `以下子目录存在规则文件（进入对应区域操作时全文会自动注入，也可直接 read）：\n${files.map((rel) => `./${rel}`).join("\n")}`;
        pi.sendMessage(
          {
            customType: CUSTOM_TYPE,
            content: `${notice}\n${content}`,
            details: { notice, rel: INDEX_REL },
            display: true,
          },
          { deliverAs: "steer" },
        );
      }
      indexInjected = true;
    }

    for (const rel of toProcess) {
      if (inContextRels.has(rel)) {
        continue; // 同文件已在上下文
      }
      if (explicitlyRead.has(rel)) {
        continue; // 代理已显式读取，内容已作为 tool_result 进 LLM
      }
      const content = readContent(path.resolve(root, rel));
      if (content === null) {
        continue; // 文件读取失败，允许下次重试
      }
      const hash = hashOf(content);
      if (inContextHashes.has(hash) || seenHashes.has(hash)) {
        continue; // 同内容已在上下文（别的子包）或本 turn 已投递，跳过
      }
      seenHashes.add(hash);
      // TUI 渲染由 renderInjectNotice 统一（collapsed 只显示提示，
      // Ctrl+O 展开显示全文）；content 总进 LLM，display 只控 TUI
      const notice = injectNotice(rel);
      pi.sendMessage(
        {
          customType: CUSTOM_TYPE,
          content: `${notice}\n${content}`,
          details: { notice, rel, hash },
          display: true,
        },
        { deliverAs: "steer" },
      );
    }
  });

  // Compact 后 tool_result 被压缩、代理不再记得内容，允许重新注入（索引同理）
  pi.on("session_compact", async () => {
    explicitlyRead.clear();
    indexInjected = false;
  });
}
