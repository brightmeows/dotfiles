/**
 * 临时 prepare-commit-msg hook 的脚本内容。
 *
 * 脚本按以下顺序工作：
 *
 * 1. 清掉进程里所有 GIT_CONFIG_* 覆盖，让 git 看到仓库原本的 core.hooksPath。
 * 2. 执行仓库原有 prepare-commit-msg；失败时按 git 语义原样退出。
 * 3. 读取会话级与仓库级退出开关；一旦关闭，只保留原有 hook 的行为。
 * 4. merge/squash 来源直接跳过，不给汇总提交加 agent 署名。
 * 5. 用 awk 删除旧的 agent 署名：邮箱等于配置邮箱或 noreply@pi.dev 的行，
 *    以及含白小喵 / brightmia 的历史行；保留人类 co-author 与其他 trailer。
 * 6. 用 git interpret-trailers 追加规范 trailer；任何一步失败都只告警，
 *    不阻塞提交。
 *
 * 这里刻意使用 POSIX sh 与 awk，不依赖 Node：Pi 既可能跑在 Node 上，也可能
 * 以 Bun 编译的独立二进制运行，process.execPath 不一定是 JS 解释器。
 *
 * 除 prepare-commit-msg 外，临时目录还为所有标准 hook 生成委托脚本。Git 用
 * core.hooksPath 覆盖时不会回退到原目录，如果只放 prepare-commit-msg，其他
 * hook 会被静默跳过；委托脚本保证 pre-commit、commit-msg、post-commit 等
 * 仍按原样执行。解析原目录前清掉所有 GIT_CONFIG_*，避免嵌套 Pi 会话继承的
 * core.hooksPath 覆盖把委托指向另一个临时目录。
 */

/** 需要原样委托给仓库真实 hooks 目录的标准 hook。 */
export const DELEGATED_HOOKS = [
  "applypatch-msg",
  "pre-applypatch",
  "post-applypatch",
  "pre-commit",
  "pre-merge-commit",
  "commit-msg",
  "post-commit",
  "pre-rebase",
  "post-checkout",
  "post-merge",
  "pre-push",
  "pre-receive",
  "update",
  "proc-receive",
  "post-receive",
  "post-update",
  "reference-transaction",
  "push-to-checkout",
  "pre-auto-gc",
  "post-rewrite",
  "sendemail-validate",
  "fsmonitor-watchman",
  "p4-changelist",
  "p4-prepare-changelist",
  "p4-post-changelist",
  "p4-pre-submit",
  "post-index-change",
] as const;

/** 清掉 GIT_CONFIG_* 的 shell 函数；两个脚本共用同一段文本。 */
const CLEAR_CONFIG_FUNCTION = `pi_git_attribution_clear_config() {
  for var in $(env | grep '^GIT_CONFIG_' | cut -d= -f1); do
    unset "$var"
  done
}`;

/** 通用委托 hook：找到仓库真实 hooks 目录后执行同名 hook。 */
export function buildDelegatingHookScript(): string {
  return `#!/bin/sh
# 由 pi-meow-git-attribution 生成；把同名 hook 委托给仓库真实 hooks 目录。
set -u

hook_name="$(basename "$0")"
${CLEAR_CONFIG_FUNCTION}
pi_git_attribution_clear_config

hooks_dir="$(git rev-parse --path-format=absolute --git-path hooks 2>/dev/null || git rev-parse --git-path hooks 2>/dev/null || true)"
[ -n "$hooks_dir" ] || exit 0

original="$hooks_dir/$hook_name"
if [ -x "$original" ] && [ "$original" != "$0" ]; then
  "$original" "$@"
  exit $?
fi

exit 0
`;
}

export function buildHookScript(): string {
  return `#!/bin/sh
# 由 pi-meow-git-attribution 生成；临时目录随会话结束删除。
set -u

message_file="\${1:-}"
msg_source="\${2:-}"
[ -n "$message_file" ] || exit 0

${CLEAR_CONFIG_FUNCTION}
pi_git_attribution_clear_config

# 原有 hook 必须始终执行，包括退出开关关闭与 merge/squash 场景。
hooks_dir="$(git rev-parse --path-format=absolute --git-path hooks 2>/dev/null || git rev-parse --git-path hooks 2>/dev/null || true)"
if [ -n "$hooks_dir" ]; then
  original="$hooks_dir/prepare-commit-msg"
  if [ -x "$original" ] && [ "$original" != "$0" ]; then
    "$original" "$@" || exit $?
  fi
fi

case "$(printf '%s' "\${PI_GIT_ATTRIBUTION:-1}" | tr '[:upper:]' '[:lower:]')" in
  0|false|no|off) exit 0 ;;
esac

if [ "$(git config --local --bool --get pi.attribution 2>/dev/null || true)" = "false" ]; then
  exit 0
fi

case "$msg_source" in
  merge|squash) exit 0 ;;
esac

co_author="\${PI_GIT_ATTRIBUTION_CO_AUTHOR:-}"
co_author_email="\${PI_GIT_ATTRIBUTION_CO_AUTHOR_EMAIL:-noreply@pi.dev}"
generated_by="\${PI_GIT_ATTRIBUTION_GENERATED_BY:-}"
[ -n "$co_author" ] || exit 0

tmp="$message_file.pi-attribution-tmp"
if ! awk -v email="$co_author_email" '
  BEGIN {
    lower_email = tolower(email)
  }
  /^[[:space:]]*[Cc]o-[Aa]uthored-[Bb]y:[[:space:]]*/ {
    lower = tolower($0)
    if (index(lower, "<" lower_email ">") > 0 || index(lower, "<noreply@pi.dev>") > 0) next
    if ($0 ~ /白小喵/ || lower ~ /brightmia/) next
  }
  /^[[:space:]]*[Gg]enerated-[Bb]y:[[:space:]]*/ {
    if ($0 ~ /^[[:space:]]*[Gg]enerated-[Bb]y:[[:space:]]*[Pp]i([[:space:]]|$)/) next
  }
  { print }
' "$message_file" > "$tmp"; then
  rm -f "$tmp"
  echo "pi-git-attribution: 消息规范化失败，跳过署名" >&2
  exit 0
fi

if ! mv "$tmp" "$message_file"; then
  rm -f "$tmp"
  echo "pi-git-attribution: 消息写回失败，跳过署名" >&2
  exit 0
fi

set -- --trailer "$co_author"
if [ -n "$generated_by" ]; then
  set -- "$@" --trailer "$generated_by"
fi

if ! git -c trailer.co-authored-by.ifExists=addIfDifferent \\
    -c trailer.generated-by.ifExists=addIfDifferent \\
    interpret-trailers --in-place "$@" "$message_file"; then
  echo "pi-git-attribution: trailer 追加失败，跳过署名" >&2
  exit 0
fi

exit 0
`;
}
