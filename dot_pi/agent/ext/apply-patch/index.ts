/**
 * pi-meow-apply-patch 入口：转发 src/index.ts（上游文件结构原样保留，便于与
 * @d3ara1n/pi-apply-patch 上游 diff 复核）。
 *
 * Fork 基线：@d3ara1n/pi-apply-patch@0.2.0（Apache-2.0，见 LICENSE 与 NOTICE）。
 * 本包相对上游的全部差异集中在渲染层（src/tool.ts、src/render.ts、
 * src/stream-preview.ts），执行层（src/core/、src/apply.ts、src/workspace.ts、
 * src/parser.ts 等）与上游逐字一致——升级上游时只需重审执行层 diff。
 *
 * 差异摘要（设计文档，改渲染前完整读本文件与 src/tool.ts 头注释）：
 * - 流式预览：参数生成阶段在调用组件内实时显示改动范围。封口 hunk 读磁盘跑
 *   执行层同款 planUpdate/applyReplacements 出真 diff，写入中 section 的
 *   +/- 行直接着色，匹配失败 hunk 黄色警告。见 src/stream-preview.ts。
 * - 执行后：diff 默认全量展开（上游折叠在展开态且每文件 120 行 cap），调用
 *   头为带状态背景色的 Box（对齐内建 edit 工具的观感）。
 * - 上游互动：渲染增强已提 issue/PR 回 d3ara1n/pi-extensions；上游收录后
 *   本 fork 撤销回 npm 包，被拒则冻结自养（ask-user-question 先例模式）。
 */
import applyPatchExtension from "./src/index.ts";

export default applyPatchExtension;
