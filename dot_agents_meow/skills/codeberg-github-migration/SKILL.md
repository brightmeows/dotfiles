---
name: codeberg-github-migration
description: 将纯 Codeberg 仓库迁移为“GitHub 主仓库 + Codeberg 镜像”架构时使用。触发词包括：迁移到 GitHub、GitHub 主仓库、Codeberg 镜像、建 GitHub 仓库、GitHub Pages 部署、仓库双平台。涉及跨哈希（sha256 转 sha1）时先加载 git-hash-repo-conversion 技能。不负责 GitHub/GitLab 等其他 forge 之间的迁移，也不负责从 GitHub 迁回 Codeberg。
---

# Codeberg 迁移至 GitHub 主仓库 + Codeberg 镜像

## 适用判别

执行迁移前先回答三个判别问题，决定本 checklist 的子集：

1. **源仓库哈希格式**：`git rev-parse --show-object-format`。结果为 `sha256` 时，必须先完成跨哈希转换才能推 GitHub（GitHub 服务端只收 sha1），加载 `git-hash-repo-conversion` 技能；`sha1` 则跳过转换。
2. **是否有静态站点**：仓库有无 SSG 构建（SvelteKit/Astro/Hugo 等）与站点部署需求。有则执行 Pages 相关步骤；纯代码仓库跳过全部 Pages 章节，只需仓库与镜像。
3. **现有 CI 形态**：源仓库在 Codeberg 用 Forgejo Actions 时，workflow 文件（`.forgejo/workflows/`）需适配为 GitHub Actions（`.github/workflows/`）；迁移后 Forgejo workflow 保留与否取决于镜像站是否继续部署。

## 第 0 步：准备凭据

- **GitHub 侧**：确认 `gh` CLI 已登录且 token 有 `repo`、`workflow` scope（`gh auth status`）。
- **Codeberg 侧**：请用户在 Settings → Applications 生成一个 token，权限仅需 **repository 读写**。约定：token 仅在本次会话使用，迁移完成后提醒用户吊销。
- token 会出现在会话上下文中，不落盘、不写入任何文件。

## 安全红线

> 本技能中标注 **[待实测]** 的 API 命令来自 Gitea/Forgejo 官方文档，未在 Codeberg 实测过。Codeberg 的 Forgejo 版本可能与文档版本有出入，首个项目迁移时逐条实测并回填结果（校准方式见“批量使用”节）。
>
> 标注 **[时效性]** 的事实随平台演化，执行时先按参考资料链接复核：GitHub 对 sha256 的支持现状、GitHub 对 `gpgsig-sha256` 提交头的接受性。

## 主流程 checklist

按序执行，方括号条件不满足则跳过该步。

### 1. 前置核查

- [ ] 确认 GitHub 账号与用户名（`gh api user`），用户 Pages 仓库名必须是 `<用户名>.github.io`
- [ ] [源仓库为 sha256] 走跨哈希转换，产出 sha1 工作副本（辅技能）；转换后逐字节验证签名保留
- [ ] [有签名提交] 试推验证 GitHub 对 `gpgsig-sha256` 头的接受性——**先推一个小提交再推全量**，被拒则回来与用户重新盘问签名策略
- [ ] 确认签名钥匙与提交邮箱已注册到 GitHub 账号（Settings → SSH and GPG keys），否则 Verified 徽章不生效
- [ ] 无 LFS（`ls .gitattributes`；有 LFS 则本技能未覆盖，停下报告）

### 2. GitHub 建仓与推送

```bash
gh repo create <user>/<repo> --public --description "..."   # 用户 Pages 仓库必须名为 <user>.github.io
git remote add origin git@github.com:<user>/<repo>.git
git push -u origin main
```

- 硬编码了旧平台 URL 的构建脚本（prebuild/jq、站点内绝对 URL）先改再推，避免首次部署就产出错误内容。

### 3. GitHub Actions 恢复与适配

- 从源仓库历史挖旧 workflow（`git log --all -- .github/workflows/`），逐个核对数据源与版本是否过时（数据源变更、pnpm/action 大版本），不能直接复用。
- 查各 action 当前主版本：`gh api repos/<owner>/<action>/releases/latest --jq .tag_name`，不凭记忆写版本号。
- 触发器对应迁移：Forgejo 的 `schedule`/`push` 语义与 GitHub 相同；部署用 `actions/upload-pages-artifact` + `actions/deploy-pages@v5`。

### 4. Pages 启用 [有静态站]

```bash
# GitHub 常在首次 push 后自动启用旧式分支部署（build_type=legacy），需切到 Actions 源：
gh api -X PUT repos/<user>/<repo>/pages -f build_type=workflow
gh api repos/<user>/<repo>/pages --jq '{build_type, source}'
```

部署 workflow 可手动触发验证：`gh workflow run <name> --ref main`。

### 5. 分支保护与 PR 流程

```bash
gh api -X PATCH repos/<user>/<repo> -f allow_auto_merge=true
gh api -X PUT repos/<user>/<repo>/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": {"strict": false, "contexts": ["<ci 各 job 名>"]},
  "enforce_admins": true,
  "required_pull_request_reviews": {"required_approving_review_count": 0},
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

> **必知差异**：`required_approving_review_count: 0` 对单人仓库是防死锁关键——要求审批会因无法自批而永久卡住 PR。`enforce_admins: true` 意味着管理员也受保护规则约束（直推被拒），一切改动走 PR。此配置是否合意由用户在盘问中决定，勿默认。
>
> **时序红线**：保护规则必须在首次 push 之后启用，否则首推被挡。

### 6. Codeberg 镜像侧重构

```bash
# Codeberg API 前缀：https://codeberg.org/api/v1
curl -s -X PATCH 'https://codeberg.org/api/v1/repos/<user>/<旧仓>' \
  -H "Authorization: token $CODEBERG_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name": "<repo>-archive"}'                                    # [待实测] rename
curl -s -X POST 'https://codeberg.org/api/v1/user/repos' \
  -H "Authorization: token $CODEBERG_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name": "<repo>"}'                                            # 默认 sha1 即目标格式
```

> **必知差异**：Codeberg 现役 Pages 是 git-pages（旧 pages-server 维护模式）。部署域名与仓库名绑定：根域名 `<user>.codeberg.page` 要求发起部署的仓库命名为 `pages`；子路径站点要求仓库名匹配 `{user}.codeberg.page/{repo}`；名字不匹配需 PAT。改名到新建 `pages` 之间，镜像站内容短暂空窗（旧静态部署仍在服务，内容为旧构建）。

### 7. 镜像同步

deploy key 路线（推荐，见“批量使用”节）：

```bash
ssh-keygen -t ed25519 -f /tmp/cb-deploy -N '' -C 'github-actions-mirror'
# 公钥经 API 加为 deploy key（写权限）：
curl -s -X POST "https://codeberg.org/api/v1/repos/<user>/<repo>/keys" \
  -H "Authorization: token $CODEBERG_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"key\": \"$(cat /tmp/cb-deploy.pub)\", \"title\": \"github-actions-mirror\", \"read_only\": false}"
# 私钥入 GitHub Secrets，随后删除本地私钥文件：
gh secret set CODEBERG_DEPLOY_KEY -R <user>/<repo>.github.io < /tmp/cb-deploy && rm /tmp/cb-deploy
```

同步 workflow（push main 即同步 + 每周 cron 兜底收敛漂移窗口）：

```yaml
name: Mirror to Codeberg
on:
  workflow_dispatch:
  push:
    branches: "main"
  schedule:
    - cron: "30 4 * * 1"
jobs:
  mirror:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with: { fetch-depth: 0 }
      - name: Set up deploy key
        env: { DEPLOY_KEY: "${{ secrets.CODEBERG_DEPLOY_KEY }}" }
        run: |
          mkdir -p ~/.ssh
          echo "$DEPLOY_KEY" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          ssh-keyscan codeberg.org >> ~/.ssh/known_hosts
      - run: |
          git remote add codeberg git@codeberg.org:<user>/<repo>.git
          git push codeberg main
```

- Forgejo 侧镜像仓库的 workflow 适配：`.forgejo/workflows/` 里 `GIT_DEFAULT_HASH` 环境变量与实际格式不符时必须移除（checkout 会报 mismatched algorithms）。
- **[待实测] Codeberg 仓库级 Actions 需启用**（API：`PATCH /repos/{owner}/{repo}` 带 `has_actions: true`），push 事件早于启用会被错过且不补跑，需手动触发。
- **[待实测] workflow_dispatch 触发**：`POST /repos/{owner}/{repo}/actions/workflows/<workflow_id>/dispatches`。
- 首次部署验证：镜像站内容应以构建产物的新 URL 判定新鲜度，HTTP 200 可能只是旧部署残留。

### 8. 收尾验证清单

- GitHub：远端 HEAD 与本地一致、提交 Verified（新提交）、Pages 200、保护规则生效（试推被拒）
- Codeberg：镜像 main HEAD 与 GitHub 一致、镜像站 200 且内容新鲜、旧归档仓库原史完整
- 双侧 tables/构建产物 URL 指向约定域名（主站域名）
- 提醒用户吊销第 0 步的 Codeberg token

## 批量使用

- 首个项目选**最简单**的（无签名、无特殊数据管线），作为 API 命令与流程的校准载体；[待实测] 项逐条验证并回填本技能。
- 每项目固定验证：第 8 步收尾清单，一项不落。
- 失败项目排队记录原因，不阻塞后续项目；同因失败不重试，先诊断。
- token 按项目单独生成或一token多用由用户定，默认建议用完即吊销。

## 案例附录：pages 项目迁移快照（2026-09-14）

- 源仓库 sha256 + 114 个 `gpgsig-sha256` 签名提交；fast-export/import 转 sha1 后签名字节逐字节保留，GitHub 全数接受。
- 用户决策：签名原样保留（不重签）；分支保护 enforce_admins 不豁免 + 0 必需批准；ci 恢复旧三 job 结构；dependabot 周频。
- 坑位实录：
  - GitHub 首推后自动启用旧式 Pages（build_type=legacy），需显式 PUT 切 workflow 模式，且 `POST .../pages` 已存在时报 409。
  - 镜像站 HTTP 200 不等于部署成功——旧静态内容会继续服务，以产物内 URL 判新鲜度。
  - Codeberg 与 GitHub 的 runner jq 版本对 `@uri` 括号编码不同，产物 URL 等价可用（SvelteKit 路由解码后等价），非缺陷。
  - `pages` 与 `pages-archive` 的 Forgejo workflow 需要分别适配：新仓移除 sha256 env，归档仓的 cron 部署因域名不匹配会失败报红（可禁用其 Actions）。

## 参考资料

官方文档：

- Forgejo repo mirror：<https://forgejo.org/docs/v15.0/user/repo-mirror/>
- Forgejo Actions reference（schedule/dispatch 语义）：<https://forgejo.org/docs/v15.0/user/actions/reference/>
- Gitea API repo-edit（rename、`has_actions`、`object_format_name`）：<https://docs.gitea.com/api/next/operations/repo-edit>
- Gitea API deploy key（repoCreateKey）：<https://docs.gitea.com/api/next/operations/repo-create-key>
- GitHub Pages：<https://docs.github.com/pages>
- GitHub branch protection API：<https://docs.github.com/rest/branches/branch-protection>
- GitHub workflow dispatch API：<https://docs.github.com/rest/actions/workflows>
- Codeberg Actions 限额与 fair-use：<https://codeberg.org/actions/meta>

关键社区实证：

- GitHub 拒收 sha256 push 与 compatObjectFormat 实测：<https://github.com/orgs/community/discussions/154056>
- git-pages 部署机制与域名绑定规则实测：<https://andre601.ch/blog/2026/04-24-using-git-pages-on-codeberg/>
- Git hash 过渡设计（`gpgsig-sha256` 头语义）：<https://git-scm.com/docs/hash-function-transition>
