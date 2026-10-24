import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { TabBar } from "./tab-bar.ts";

const theme = {
  bg: (_role: string, text: string) => text,
  fg: (_role: string, text: string) => text,
} as unknown as Theme;

function bar(labels: readonly string[], active: number, answered: readonly number[] = []): TabBar {
  const tabBar = new TabBar(theme);
  tabBar.setProps({
    tabs: labels.map((label, index) => ({
      label,
      answered: answered.includes(index),
      active: index === active,
    })),
    submit: { active: false, allAnswered: false },
  });
  return tabBar;
}

function longLabels(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `Header${index + 1}`.padEnd(16, "x"));
}

test("renders every tab when the strip fits", () => {
  const line = bar(["One", "Two", "Three"], 1, [0]).render(120)[0] ?? "";
  for (const label of ["One", "Two", "Three"]) assert.match(line, new RegExp(label));
  assert.match(line, /■/);
  assert.match(line, /Submit/);
  assert.ok(visibleWidth(line) <= 120);
});

test("keeps the active tab and Submit visible when the strip overflows", () => {
  const line = bar(longLabels(8), 6).render(100)[0] ?? "";
  assert.match(line, /Header7/);
  assert.match(line, /…/);
  assert.match(line, /Submit/);
  assert.ok(visibleWidth(line) <= 100);
});

test("falls back to the compact indicator on narrow terminals", () => {
  const line = bar(longLabels(8), 7).render(30)[0] ?? "";
  assert.match(line, /8\/8/);
  assert.match(line, /Submit/);
  assert.ok(visibleWidth(line) <= 30);
});

test("never exceeds the terminal width", () => {
  for (const width of [16, 24, 40, 80, 140]) {
    const line = bar(longLabels(12), 9).render(width)[0] ?? "";
    assert.ok(visibleWidth(line) <= width, `width ${width}: ${line}`);
  }
});
