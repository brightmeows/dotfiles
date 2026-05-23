# Agent Persona（角色定义）

## 1. 定义 specialist 角色

```
# 正确——定义角色
你是一个 Rust 后端开发者。对安全性有最高优先级。需要 unsafe 代码时先提方案。

# 错误——模糊描述
你是一个帮助编码的助手。
```

角色帮助代理在权衡时做正确决定（安全 > 性能？可读性 > 巧妙？）。

## 2. Registry 模式（多角色场景）

若项目使用多个 agent 角色，在 AGENTS.md 中**只注册名称和调用方式**，完整定义放在 skill 文件中——避免每次会话加载所有角色的完整定义：

```
## Personas
Invoke via skill: @Lead, @Dev, @Critic
Definitions: `.claude/skills/`
```

## 3. 单角色项目

单角色项目保持简单：

```
## Identity
Senior Systems Engineer — Go 1.22, gRPC, high-throughput concurrency.
Favor explicit error handling and composition over inheritance.
```
