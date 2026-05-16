---
description: 代码审查：与 main 比较
---

# Code Review 循环

## 一曰审

启 code reviewer 子 agent，检当前分支与 main 分支之 diff。
并查实现问题与可优化处。

### 注

审Agent唯析问题，禁改内容。

## 二曰修

报所发诸问题，修其可修者。
行项目检查并修之，后提交，毕一轮。

## 三曰复

用同提示，再启 code reviewer，启下一轮。
勿带上轮修改，勿复用旧会话。

如是循环，至无问题。