import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readCropConfig } from "./render.ts";
import { makeApplyPatchTool } from "./tool.ts";

export default function applyPatchExtension(pi: ExtensionAPI): void {
  // 折叠限行配置（settings 键 applyPatchPreview）。getSettings 是 action method，
  // 工厂加载期禁调（实测：Extension runtime not initialized），延到 session_start；
  // 渲染经 getter 每帧读闭包变量，session_start（含 /reload）后即为新值。
  let cropConfig = readCropConfig(undefined);
  pi.on("session_start", () => {
    try {
      cropConfig = readCropConfig(pi.getSettings());
    } catch {
      // runtime 未就绪等异常：保持默认，不影响渲染
    }
  });
  pi.registerTool(makeApplyPatchTool(undefined, () => cropConfig));
}
