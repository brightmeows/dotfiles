/**
 * Subdirectory AGENTS.md Extension
 *
 * 懒加载子目录 AGENTS.md：当 LLM 访问某目录下的文件或其同名文件（如
 * src/memory.rs → src/memory/AGENTS.md）时自动注入该子包的 AGENTS.md。
 *
 * 补足 Pi 默认只向上（父目录）不向下（子目录）的加载策略。
 * 注入方式参考 receiving-review.ts：context 事件推送至消息列表。
 *
 * 规则：
 * - 仅当目录被「访问」时才加载（read / write / edit / bash cd 等工具调用）
 * - 各 AGENTS.md 独立记录加载状态，每 session 最多注入一次
 * - compact 后重置所有状态为未加载，允许重新注入
 * - 跳过隐藏目录及被 .gitignore 忽略的目录
 * - /reload 时重新扫描并重置状态
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ── Helpers ──

/** 目录是否被 git ignore？非 git 仓库或出错时返回 false */
function isGitIgnored(dir: string): boolean {
	try {
		execSync("git check-ignore -q .", {
			cwd: dir,
			encoding: "utf8",
			stdio: ["ignore", "ignore", "ignore"],
			timeout: 1000,
		});
		return true;
	} catch {
		return false;
	}
}

/** 将工具参数中的路径规范化：绝对 → 相对 cwd，去 ./ 前缀 */
function normalizePath(rawPath: string, cwd: string): string {
	const normalized = path.normalize(rawPath);
	if (path.isAbsolute(normalized)) {
		return path.relative(cwd, normalized);
	}
	return normalized;
}

/** 从工具调用参数中提取被访问的文件/目录路径 */
function extractAccessedPath(
	toolName: string,
	input: Record<string, unknown> | undefined | null,
	cwd: string,
): string | null {
	if (!input) return null;

	switch (toolName) {
		case "read":
		case "write":
		case "edit":
		case "grep":
		case "find": {
			const p = input["path"];
			return typeof p === "string" ? normalizePath(p, cwd) : null;
		}
		case "bash": {
			const cmd = input["command"];
			if (typeof cmd !== "string") return null;
			const trimmed = cmd.trim();
			const cd = trimmed.match(/^(?:cd|pushd)\s+(\S+)/);
			if (cd?.[1]) return normalizePath(cd[1], cwd);
			const readCmd = trimmed.match(
				/^(?:ls|ll|la|cat|head|tail|less|more|rg|grep|find|stat|du|file)\s+(\S+)/,
			);
			if (readCmd?.[1]) return normalizePath(readCmd[1], cwd);
			return null;
		}
		default:
			return null;
	}
}

// ── Scanner ──

interface ScannedFile {
	/** 相对于 cwd 的路径，如 subpkg/a/AGENTS.md */
	relPath: string;
	/** 触发的父目录路径，如 subpkg/a */
	parentDir: string;
	/** 文件原始内容 */
	content: string;
}

function scanAgentsFiles(cwd: string, dir: string): ScannedFile[] {
	const results: ScannedFile[] = [];
	let entries: fs.Dirent[];

	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	for (const entry of entries) {
		if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
		if (entry.name.startsWith(".")) continue;
		if (isGitIgnored(path.join(dir, entry.name))) continue;

		const fullPath = path.join(dir, entry.name);
		const agentsPath = path.join(fullPath, "AGENTS.md");

		try {
			if (fs.statSync(agentsPath).isFile()) {
				const relPath = path.relative(cwd, agentsPath);
				results.push({
					relPath,
					parentDir: path.dirname(relPath),
					content: fs.readFileSync(agentsPath, "utf8"),
				});
			}
		} catch {
			// 无 AGENTS.md，继续递归
		}

		results.push(...scanAgentsFiles(cwd, fullPath));
	}

	return results;
}

// ── Matching ──

/**
 * 判断 accessedPath 是否命中某 AGENTS.md 的触发条件：
 *   - 直接访问子目录本身               (accessedPath === parentDir)
 *   - 访问子目录下的文件                (accessedPath.startsWith(parentDir + "/"))
 *   - 访问子目录的同名兄弟文件（任意后缀）(accessedPath.startsWith(parentDir + "."))
 */
function matchesAccess(file: ScannedFile, accessedPath: string): boolean {
	if (accessedPath === file.parentDir) return true;
	if (accessedPath.startsWith(file.parentDir + "/")) return true;
	if (accessedPath.startsWith(file.parentDir + ".")) return true;
	return false;
}

// ── Formatting ──

function formatContent(files: ScannedFile[]): string {
	const parts: string[] = [
		"以下为本项目子目录中的 AGENTS.md 文件内容。这些指令适用于对应子包。",
	];

	for (const file of files) {
		parts.push("", `## ./${file.relPath}`, "", file.content.trim());
	}

	return parts.join("\n");
}

// ── Extension ──

export default function subdirAgentsMdExtension(pi: ExtensionAPI) {
	let scanned: ScannedFile[] = [];
	let loadedRelPaths = new Set<string>();
	let pendingRelPaths = new Set<string>();

	function scanAndSort(cwd: string): ScannedFile[] {
		const raw = scanAgentsFiles(cwd, cwd);

		raw.sort((a, b) => {
			const aDepth = a.relPath.split("/").length;
			const bDepth = b.relPath.split("/").length;
			return aDepth - bDepth || a.relPath.localeCompare(b.relPath);
		});

		return raw;
	}

	// ── session_start / reload：重新扫描并重置状态 ──
	pi.on("session_start", async (_event, ctx) => {
		scanned = scanAndSort(ctx.cwd);
		loadedRelPaths.clear();
		pendingRelPaths.clear();

		if (scanned.length > 0) {
			ctx.ui.notify(
				`subdir-agents-md: monitoring ${scanned.length} AGENTS.md — ${scanned.map((f) => f.relPath).join(", ")}`,
				"info",
			);
		}
	});

	// ── 工具调用时检测目录访问 ──
	pi.on("tool_call", async (event, ctx) => {
		if (scanned.length === 0) return;

		const accessedPath = extractAccessedPath(event.toolName, event.input, ctx.cwd);
		if (!accessedPath) return;

		for (const file of scanned) {
			if (loadedRelPaths.has(file.relPath)) continue;
			if (matchesAccess(file, accessedPath)) {
				pendingRelPaths.add(file.relPath);
			}
		}
	});

	// ── 下一轮 LLM 调用前注入待加载的 AGENTS.md ──
	pi.on("context", async (event) => {
		if (pendingRelPaths.size === 0) return;

		// 收集尚未加载的
		const triggered = scanned.filter(
			(f) => pendingRelPaths.has(f.relPath) && !loadedRelPaths.has(f.relPath),
		);
		pendingRelPaths.clear();

		if (triggered.length === 0) return;

		for (const f of triggered) loadedRelPaths.add(f.relPath);

		const text = formatContent(triggered);

		event.messages.push({
			role: "user",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		});

		return { messages: event.messages };
	});

	// ── compact 后重置状态，允许重新注入 ──
	pi.on("session_compact", async () => {
		loadedRelPaths.clear();
	});
}
