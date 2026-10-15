/**
 * 左色带装饰容器：子组件渲染的每个非空行最左侧拼上色带字符，
 * 空行断开（引用块风格，避免竖线穿过空行显重）。
 * 子组件可用宽度收窄 BAR_WIDTH 列，内容整体右移形成缩进层次。
 */

import type { Component } from "@earendil-works/pi-tui";

const BAR_WIDTH = 2;

export class LeftBar implements Component {
  private readonly child: Component;
  private readonly bar: string;

  constructor(child: Component, bar: string) {
    this.child = child;
    this.bar = bar;
  }

  invalidate(): void {
    this.child.invalidate();
  }

  render(width: number): string[] {
    const lines = this.child.render(Math.max(width - BAR_WIDTH, 1));
    return lines.map((line) => (line.trim().length === 0 ? "" : `${this.bar} ${line}`));
  }
}
