# Nushell 升级至官方 Gemfury 仓库记录

> 系统: Fedora Linux 44.20260707.0 (Kinoite), amd64
> 记录日期: 2026-07-15

## 背景

Fedora 44 仓库中 nushell 版本长期停滞在 `0.99.1`（2024-10 上游版本），落后上游约 9 个月、15 个大版本。

## 操作

### 添加 Gemfury 官方仓库

写入 `/etc/yum.repos.d/fury-nushell.repo`：

```ini
[gemfury-nushell]
name=Gemfury Nushell Repo
baseurl=https://yum.fury.io/nushell/
enabled=1
gpgcheck=0
gpgkey=https://yum.fury.io/nushell/gpg.key
```

### 升级

```bash
rpm-ostree uninstall nushell
rpm-ostree install nushell
```

| 项目 | 前 | 后 |
|------|----|----|
| 版本 | `0.99.1-4.fc44` | `0.114.1-0` |
| 来源仓库 | Fedora 44 updates | Gemfury (yum.fury.io/nushell) |
| 构建日期 | 2026-05-30 | 2026-07-11 |

### Gemfury 说明

[Gemfury](https://gemfury.com/) 是一个商业软件包托管服务，支持 RPM/DEB/RubyGems/npm/PyPI 等多种格式。Nushell 项目使用 Gemfury 的免费公共层作为其官方 RPM 分发渠道，相当于 nushell 团队的**官方 Fedora 仓库**，版本更新速度远快于 Fedora 自身的打包流程。

## 签名情况

该仓库的 RPM 包 **没有 GPG 签名**：

| 检查项 | 结果 |
|--------|------|
| RPM 包自身 PGP 签名 | ❌ 无（仅 Header/Payload SHA256 摘要校验） |
| repomd.xml 仓库元数据签名 | ❌ 无 |
| GPG 公钥 (`https://yum.fury.io/nushell/gpg.key`) | ✅ 存在但未实际用于签名 |

SHA256 摘要只能保证下载完整性（文件没损坏），**不能验证发布者身份**。不过传输层走 HTTPS（TLS），中间人篡改已有较高门槛。对于 nushell 官方指定的分发渠道，日常使用风险可接受。

## 注意事项

- 该仓库 GPG 检查未启用（`gpgcheck=0`），因 RPM 本身无签名
- 后续 nushell 更新通过 `rpm-ostree upgrade` 自动拉取 Gemfury 仓库的版本
- 如需退回 Fedora 官方版本：`rpm-ostree uninstall nushell && rm /etc/yum.repos.d/fury-nushell.repo && rpm-ostree install nushell`
- 如需更严格的验证：从 GitHub Releases 下载 tar.gz + 核对 `SHA256SUMS`
