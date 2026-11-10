/**
 * dsh-prompt-relocation — 把扩展贡献的系统提示词段迁出系统提示词，
 * 转投 runtime 上下文快照：模型在首条用户消息之后收到它们，
 * 而不是在系统提示词里。段名保留为快照内的来源标注。
 *
 * 机制：挂在 `system-prompt/assemble` waterfall（返回文本即权威），
 * 在其他监听器之后把名称不匹配保留前缀的段从 `sections` 搬进
 * `contexts`。快照通道对 waterfall 加入的上下文按已接纳值保留，
 * 不重跑本监听器；会话中途新注册的段在下一步组装时同样被迁出，
 * 生成取代旧快照的新快照。
 *
 * 保留集按名称前缀匹配第一方段（工具指导、persona、政策、文件引用、
 * 交付物提示）。`complete: true` 的段由组装在 waterfall 之后恢复为
 * 唯一提示词，本插件搬不动也不需要搬。
 */

/**
 * 无 Config schema 导出：profile 的 schemastery 为 CJS-only，链接安装
 * 无法解析；配置在 cordis.patch.yml 声明，缺失字段走内置默认值。
 */

/** 保留在系统提示词里的第一方段名前缀。 */
const DEFAULT_KEEP_PREFIXES = [
  "tool:",
  "deployment:",
  "plan:",
  "team:",
  "context:",
  "ui:",
  "harness:",
];

export const inject = ["systemPrompt"];

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ keepPrefixes?: string[] }} config
 */
export function apply(ctx, config) {
  const prefixes =
    Array.isArray(config.keepPrefixes) && config.keepPrefixes.length > 0
      ? config.keepPrefixes
      : DEFAULT_KEEP_PREFIXES;
  const keep = (name) => prefixes.some((prefix) => name.startsWith(prefix));

  return ctx.on("system-prompt/assemble", async (assembly, _context, next) => {
    const result = await next();
    const relocated = [];
    result.sections = result.sections.filter((section) => {
      if (keep(section.name)) return true;
      relocated.push({
        name: `relocated:${section.name}`,
        text: section.text,
        interpolate: section.interpolate,
      });
      return false;
    });
    if (relocated.length > 0) result.contexts.push(...relocated);
    return result;
  });
}
