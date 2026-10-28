# chezmoi 合并脚本机制

记录 `.chezmoiscripts/` 合并脚本的触发方式与时序约束，供新增或修改合并脚本时查阅。

## 命名与触发

合并脚本统一使用 `run_onchange_after_` 前缀：`after_` 保证脚本在数据文件部署之后执行；`onchange` 配合模板 hash，内容变化才运行。

`run_after_` 例外有两个，共同点是“触发条件不在模板 hash 里”：

- `run_after_omarchy-active-window-enable.sh.tmpl`（活动窗口组件调和），每次 apply 都运行：`omarchy refresh shell` 会把 shell.json 重置为默认，模板 hash 未变时 onchange 不会重跑、无法恢复布局条目。
- `run_after_omarchy-workspaces-enable.sh.tmpl`（工作区组件 id 替换），每次 apply 都运行：理由同上（refresh shell 后 hash 未变不重跑）；脚本自带 cmp 守卫，无变化时不动 shell.json。

## 时序约束（为什么必须 after_）

chezmoi 按 entry 名字母序应用条目，`.chezmoiscripts/`（c）排在 `.gitconfig.meow`、`.pi`、`.env_common` 等数据源之前：

- 脚本不加 `after_` 会先于数据文件运行，读到上一轮旧值；
- 且触发 hash 被消耗后不再重跑，合并永久滞后。

此坑已修复（参照 b52aefc 同款坑，两个脚本已同步改名）。新增合并脚本时沿用 `run_onchange_after_` 前缀。
