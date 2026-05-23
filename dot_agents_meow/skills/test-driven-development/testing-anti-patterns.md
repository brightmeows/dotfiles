# 测试反模式

**在以下情况加载本参考：** 编写或修改测试、添加 mock、或忍不住给生产类添加仅测试用的方法时。

## 概述

测试必须验证真实行为，不是 mock 行为。Mock 是隔离手段，不是被测对象。

**核心原则：** 测代码做什么，不是测 mock 做什么。

**严格执行 TDD 能预防这些反模式。**

## 铁律

```
1. 绝不测试 mock 行为
2. 绝不给生产类添加仅测试用的方法
3. 绝不在不了解依赖时就 mock
```

## 反模式 1：测试 Mock 行为

**违反示例：**
```typescript
// ❌ 差：测试 mock 是否存在
test('renders sidebar', () => {
  render(<Page />);
  expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument();
});
```

**为什么不对：**
- 你在验证 mock 能工作，不是组件能工作
- 有 mock 时测试通过，没有时失败
- 对真实行为一无所知

**搭档的纠正：** “我们是在测 mock 的行为吗？”

**修正：**
```typescript
// ✅ 好：测试真实组件或不 mock 它
test('renders sidebar', () => {
  render(<Page />);  // 不要 mock sidebar
  expect(screen.getByRole('navigation')).toBeInTheDocument();
});

// 或者如果为了隔离必须 mock sidebar：
// 不要在 mock 上做断言——测试 Page 在有 sidebar 时的行为
```

### 检查门

```
在对任何 mock 元素做断言之前：
  问：“我是在测真实组件行为还是 mock 的存在？”

  如果是测 mock 存在：
    停止 - 删除断言或取消 mock 该组件

  改为测试真实行为
```

## 反模式 2：生产类中的测试专用方法

**违反示例：**
```typescript
// ❌ 差：destroy() 只在测试中使用
class Session {
  async destroy() {  // 看起来像生产 API！
    await this._workspaceManager?.destroyWorkspace(this.id);
    // ... 清理
  }
}

// 在测试中
afterEach(() => session.destroy());
```

**为什么不对：**
- 生产类被测试专用代码污染
- 如果意外在生产中调用会很危险
- 违反 YAGNI 和关注点分离
- 混淆了对象生命周期与实体生命周期

**修正：**
```typescript
// ✅ 好：测试工具处理测试清理
// Session 没有 destroy()——它生产环境下是无状态的

// 在 test-utils/ 中
export async function cleanupSession(session: Session) {
  const workspace = session.getWorkspaceInfo();
  if (workspace) {
    await workspaceManager.destroyWorkspace(workspace.id);
  }
}

// 在测试中
afterEach(() => cleanupSession(session));
```

### 检查门

```
在给生产类添加任何方法之前：
  问：“这个方法只在测试中用吗？”

  如果是：
    停止 - 不要添加
    放到测试工具中

  问：“这个类拥有该资源的生命周期吗？”

  如果不是：
    停止 - 这个类不适合此方法
```

## 反模式 3：不了解就 Mock

**违反示例：**
```typescript
// ❌ 差：Mock 破坏了测试逻辑
test('detects duplicate server', () => {
  // Mock 阻止了测试依赖的配置写入！
  vi.mock('ToolCatalog', () => ({
    discoverAndCacheTools: vi.fn().mockResolvedValue(undefined)
  }));

  await addServer(config);
  await addServer(config);  // 应该抛异常——但不会！
});
```

**为什么不对：**
- 被 mock 的方法有测试依赖的副作用（写入配置）
- 为“保险”过度 mock 破坏了实际行为
- 测试因错误原因通过，或莫名其妙地失败

**修正：**
```typescript
// ✅ 好：在正确的层级 mock
test('detects duplicate server', () => {
  // Mock 慢的部分，保留测试需要的行为
  vi.mock('MCPServerManager'); // 只 mock 慢的服务器启动

  await addServer(config);  // 配置被写入
  await addServer(config);  // 重复被检测到 ✓
});
```

### 检查门

```
在 mock 任何方法之前：
  停止 - 先别 mock

  1. 问：“真实方法有什么副作用？”
  2. 问：“这个测试依赖哪些副作用？”
  3. 问：“我完全理解这个测试需要什么吗？”

  如果依赖副作用：
    在更底层 mock（实际的慢/外部操作）
    或者使用保留必要行为的测试替身
    而不是在测试依赖的高层方法上 mock

  如果不确定测试依赖什么：
    先用真实实现跑测试
    观察实际需要发生什么
    然后在正确层级加最简 mock

  红旗标志：
    - “我 mock 这个保险一点”
    - “这个可能很慢，最好 mock 掉”
    - 不了解依赖链就 mock
```

## 反模式 4：不完整的 Mock

**违反示例：**
```typescript
// ❌ 差：部分 mock——只包含你以为需要的字段
const mockResponse = {
  status: 'success',
  data: { userId: '123', name: 'Alice' }
  // 缺少：下游代码会用到的 metadata
};

// 后续：当代码访问 response.metadata.requestId 时崩溃
```

**为什么不对：**
- **部分 mock 隐藏了结构假设**——你只 mock 了你知道的字段
- **下游代码可能依赖你没包含的字段**——静默失败
- **测试通过但集成失败**——mock 不完整，真实 API 完整
- **虚假信心**——测试对真实行为证明不了什么

**铁则：** Mock 完整的数据结构（如现实中存在的那样），而不仅仅是当前测试用到的字段。

**修正：**
```typescript
// ✅ 好：镜像真实 API 的完整性
const mockResponse = {
  status: 'success',
  data: { userId: '123', name: 'Alice' },
  metadata: { requestId: 'req-789', timestamp: 1234567890 }
  // 真实 API 返回的所有字段
};
```

### 检查门

```
在创建 mock 响应之前：
  检查：“真实的 API 响应包含哪些字段？”

  操作：
    1. 从文档/示例中查看实际 API 响应
    2. 包含系统下游可能消费的所有字段
    3. 验证 mock 与真实响应 schema 完全匹配

  关键：
    如果你在创建 mock，必须理解完整的结构
    部分 mock 在代码依赖省略的字段时会静默失败

  如果不确定：包含所有文档化的字段
```

## 反模式 5：集成测试当后补

**违反示例：**
```
✅ 实现完成
❌ 没写测试
“可以测了”
```

**为什么不对：**
- 测试是实现的一部分，不是可选的后续工作
- TDD 本应已捕获这个问题
- 没有测试就不能声称完成

**修正：**
```
TDD 循环：
1. 写失败测试
2. 实现让它通过
3. 重构
4. 然后才能声称完成
```

## 当 Mock 变得过于复杂

**警告信号：**
- Mock 准备代码比测试逻辑还长
- 为了让测试通过 mock 一切
- Mock 缺少真实组件拥有的方法
- Mock 一改动测试就坏

**搭档的问题：** “这里真的需要用 mock 吗？”

**考虑：** 使用真实组件的集成测试通常比复杂的 mock 更简单

## TDD 能预防这些反模式

**为什么 TDD 有帮助：**
1. **先写测试** → 迫使你思考到底在测什么
2. **看它失败** → 确认测试测的是真实行为，不是 mock
3. **最简实现** → 测试专用方法混不进来
4. **真实依赖** → 在 mock 之前就能看到测试真正需要什么

**如果你在测 mock 行为，你就违反了 TDD**——你在没看过测试对真实代码失败的情况下就加了 mock。

## 快速参考

| 反模式 | 修正 |
|--------------|-----|
| 对 mock 元素做断言 | 测试真实组件或取消 mock |
| 生产类中的测试专用方法 | 移到测试工具中 |
| 不了解就 mock | 先了解依赖，最简 mock |
| 不完整的 mock | 完整镜像真实 API |
| 测试当后补 | TDD——测试优先 |
| 过于复杂的 mock | 考虑集成测试 |

## 红旗标志

- 断言检查 `*-mock` 测试 ID
- 方法只在测试文件中被调用
- Mock 准备代码占测试的 50% 以上
- 移除 mock 后测试失败
- 说不清为什么需要 mock
- “保险起见”就 mock

## 底线

**Mock 是隔离工具，不是被测对象。**

如果 TDD 揭示你在测 mock 行为，那就走偏了。

修正：测试真实行为，或者质疑为什么需要 mock。
