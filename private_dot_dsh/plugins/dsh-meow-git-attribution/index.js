/**
 * dsh-meow-git-attribution — dsh 会话内的 git commit 自动署名，
 * 行为对齐 Pi 侧 git-attribution 扩展（harness 层覆盖全部仓库）。
 *
 * 机制：挂在 `tools/pre-execute` waterfall，检测 bash 命令中的
 * `git commit … -m "<消息>"`，在最后一个 `-m` 消息末尾幂等追加
 * `Co-Authored-By: 白小喵 <noreply@pi.dev>`（与 Pi 侧 trailer 同一身份行，
 * 不写 Generated-By）。消息已有该 trailer、或使用 `-F`/`--file`、裸 `-m`
 * 单词、编辑器等无法安全改写的形态时原样放行，署名退回准则的手写兜底。
 *
 * 插入文本不含引号、`$`、反引号与反斜杠，单引号与双引号消息内均字面安全。
 */

const TRAILER = "\n\nCo-Authored-By: 白小喵 <noreply@pi.dev>";
const TRAILER_MARK = "Co-Authored-By: 白小喵";
/** git commit 主命令（宽松匹配：echo 里的字面 git commit 会误中，改写无害）。 */
const COMMIT_RE = /\bgit\s+[^;&|\n]*\bcommit\b/u;
/** 带引号的 -m/--message 消息段。 */
const MSG_RE = /(?:-m|--message)\s+(("((?:[^"\\]|\\.)*)"|'([^']*)'))/gu;

export const name = "meow-git-attribution";

export function apply(ctx) {
  return ctx.on("tools/pre-execute", async (exec, next) => {
    if (exec.name !== "bash") return next();
    const command = exec.arguments?.command;
    if (typeof command !== "string" || !COMMIT_RE.test(command)) return next();

    const matches = [...command.matchAll(MSG_RE)];
    if (matches.length === 0) return next();
    const last = matches[matches.length - 1];
    // 单引号与双引号分支的引号内内容都落在捕获组 2。
    const message = last[2] ?? "";
    if (message.includes(TRAILER_MARK)) return next();

    // 闭合引号之前插入：last[0] 以引号结尾，插入点即其末字符前。
    const insertAt = last.index + last[0].length - 1;
    exec.arguments = {
      ...exec.arguments,
      command: command.slice(0, insertAt) + TRAILER + command.slice(insertAt),
    };
    return next();
  });
}
