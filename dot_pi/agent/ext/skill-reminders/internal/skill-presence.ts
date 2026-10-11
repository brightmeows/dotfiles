/**
 * 技能存在性探测（包内纯库）
 *
 * 守卫语义：提醒注册项可声明 requiresPath，命中时调用；技能未安装则整条
 * 提醒静默跳过（共识："技能不存在就不注入"）。Pi 未向扩展暴露"已发现技能"
 * 的 API，技能发现位置即文件系统约定位置，裸 fs 存在性检查是唯一且确定性
 * 的方案。
 *
 * 候选目录：Agent Skills 标准位置 ~/.agents/skills（npx skills canonical）
 * 与 Pi 用户技能目录 ~/.pi/agent/skills。命中时探测、无缓存：技能安装/卸载
 * 即时生效，成本为至多两次 stat。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** 技能目录名：writing-for-agents（canonical 目录名 = 技能名） */
const SKILL_DIR = "writing-for-agents";

/** 探测 writing-for-agents 技能：存在返回其 SKILL.md 绝对路径；不存在返回 null */
export function findWritingForAgentsSkill(): string | null {
  const home = os.homedir();
  for (const dir of [
    path.join(home, ".agents", "skills"),
    path.join(home, ".pi", "agent", "skills"),
  ]) {
    const skill = path.join(dir, SKILL_DIR, "SKILL.md");
    if (fs.existsSync(skill)) {
      return skill;
    }
  }
  return null;
}
