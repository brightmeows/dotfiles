# fcitx5 profile 除管记录

## 裁决

`profile` 退出 chezmoi 管理，文件主权归还 fcitx5 运行时。`conf/`、`config` 等手编文件继续纳管，勿把 `profile` 重新 add。

## 理由

`profile` 是 fcitx5 进程拥有的运行时回写文件，退出与配置变更时规范化重写，官方 issue #948 证实只读锁无效。

copy 模式部署模型与它错配：state 账本与目标字节永久分离，导致全量 `chezmoi apply` 必然询问，内容 diff 为空也询问，判断依据是账本而不是内容。

## 恢复入口

`chezmoi forget` 等价于删源条目，不是解除部署。需要重新纳管时按“运行时回写文件”评估，先确认官方是否已提供关闭回写的配置项。
