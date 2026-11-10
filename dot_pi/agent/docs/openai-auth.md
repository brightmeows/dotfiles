# pi 接入 GPT：登录方式与 Codex CLI 认证对比

## 结论

pi（本机 1.5.0）内置两种 OpenAI 凭据路径：Sign in with ChatGPT（订阅 OAuth）与 API key。Codex CLI 面向个人的登录方式 pi 全部覆盖；面向企业的认证（Codex access tokens、Native gateway OAuth）没有原生对应物，多数可用等价机制拼出，拼不出的走 provider extension 补。两边凭据互不通用，各登各的，只有订阅额度是共享的。

代充的 ChatGPT 订阅就是正常订阅账号：只要代充账号能在网页端登录并完成 OAuth 授权，就能接入 pi。账号侧风险（付款争议、共享检测导致的封号或 token 失效）由账号本身承担，与 pi 无关。

## 接入 ChatGPT 订阅

1. pi 里运行 `/login`，选 `openai`，认证方式选 Sign in with ChatGPT
2. 浏览器完成 OpenAI OAuth 授权，回调走 localhost；pi 进程需能访问 `chatgpt.com`（本机确认代理环境变量已生效）
3. OAuth token 存入 `~/.pi/agent/auth.json`，pi 自动刷新；撤销用 `/logout`
4. `/model` 选模型，订阅登录默认 `openai/gpt-6.1-sol`（Codex 通道 500K 上下文）；`/thinking` 选推理档位，`Ctrl+P` 会话内切模型

注意点：

- 用量走订阅限额，与 Codex CLI 共享同一用量池（5 小时滚动加每周限额）；Business 工作区还受工作区限额约束，限额错误不自动重试
- 订阅登录与 API key 是两条路：订阅凭据不能喂给第三方 OpenAI 兼容端点；Decisions API 的分类器模型 `gpt-6-luna` 只认 API key，`openai` 处于订阅登录态时它不会出现在可用列表，要用需先 `/logout`
- 代充账号常见的失败形态是 token 刷新报 `refresh_token_invalidated`（账号被处理或共享登录互踢），此时重新 `/login` 即可

## 与 Codex CLI 的认证逐项对比

Codex 清单取自官方认证文档（developers.openai.com/codex/auth，2026-11-03 取）：

| Codex 方式 | pi 的对应 | 覆盖 |
|---|---|---|
| Sign in with ChatGPT（订阅 OAuth） | `/login openai` 选 Sign in with ChatGPT | 内置 |
| API key 登录（用量计费） | `/login openai` 选 API key，或 `OPENAI_API_KEY` | 内置 |
| Codex access tokens（Enterprise 非交互自动化） | 无内置选项 | 缺口 |
| 自定义 provider 配 `requires_openai_auth = true`（LLM 代理复用 OpenAI 登录） | `models.json` 只改 `baseUrl`，认证与模型目录不变 | 等价 |
| 自定义 provider 配 `env_key` | `models.json` 的 `apiKey: "$ENV_NAME"` 环境插值 | 等价 |
| Native gateway OAuth（企业 IdP 浏览器登录） | 无内置，需 provider extension 自写 OAuth 流 | 缺口，可补 |
| Command-backed auth（credential helper 取 token） | `auth.json` 的 `key: "!命令"` 或 `models.json` 的 `apiKey: "!命令"` | 等价 |
| 无认证本地模型 | dummy apiKey 加 `baseUrl`（Ollama 示例即此写法） | 等价 |

两个缺口的处理：

- Codex access tokens 是 Enterprise 工作区签发的非交互令牌，pi 没有对应登录入口。手工迁移理论可行（pi 的 OpenAI 订阅登录本就以 Codex originator 身份与 OpenAI 通信）但字段结构不同、刷新行为不保证，不推荐。正规做法是写 provider extension 注册自定义认证流，注册后直接出现在 `/login`
- Native gateway OAuth 同样靠 provider extension 补；pi 的扩展框架支持浏览器跳转、device code、手动粘贴回调三种交互，能力不缺

## 凭据存储与互通

- Codex 存 `~/.codex/auth.json` 或系统 keyring（`cli_auth_credentials_store` 取 `file`/`keyring`/`auto`/`ephemeral`）；pi 只存 `~/.pi/agent/auth.json`，keyring 无原生集成，用 `!命令` 从 secret manager 桥接
- pi 的 `auth.json` 每个 provider 存一条凭据，形状为 `type: "api_key"`（`key` 可为 `!命令`）或 `type: "oauth"`（`refresh`/`access`/`expires`），定义见 pi-ai 包 `dist/auth/types.d.ts`
- pi 不读 `~/.codex/auth.json`：coding-agent 源码无任何 `.codex` 路径引用。Codex 已登录不代表 pi 可用，反之亦然；同一账号两边各登录一次，token 各自独立
- 旧的 OpenAI Codex provider（走 `chatgpt.com/backend-api` 的独立条目）已标记 legacy，被 `openai` provider 上的 Sign in with ChatGPT 取代；pi 会在登录时存稳定 `deviceId` 到全局设置

## 事实来源

- pi 文档：`/usr/lib/node_modules/pi/packages/coding-agent/docs/` 下 `models.md`、`providers.md`、`custom-provider.md`（pi 1.5.0）
- pi CHANGELOG：Sign in with ChatGPT 引入条目、legacy Codex provider 改名条目、`refresh_token_invalidated` 修复条目
- Codex 官方认证文档：developers.openai.com/codex/auth
- 本机源码核对：pi-ai 包 `dist/auth/types.d.ts`（凭据形状）、coding-agent `dist/core/auth-storage.js`（存储实现）、全包 grep 无 `~/.codex` 引用
