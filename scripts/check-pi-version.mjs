#!/usr/bin/env node
/**
 * Fail when the repo's declared Pi host versions drift from the installed `pi`.
 *
 * The repo type-checks extensions against `node_modules`, while Pi runs from a
 * global install that the package manager cannot pin. This check keeps the two
 * in sync:
 *
 * - the host packages are declared as exact versions (no ranges);
 * - installed `@earendil-works/pi-*` versions equal `pi --version`;
 * - `typebox` equals the pin declared by the installed `pi-coding-agent`
 *   (Pi resolves `typebox` to its own copy for every extension).
 *
 * Missing `pi` is a skip: a machine without Pi cannot run the extensions, so
 * it should not block commits. Every other mismatch exits 1.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HOST_PACKAGES = [
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
];
const EXACT_VERSION = /^\d+\.\d+\.\d+$/u;

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(ROOT, relativePath), "utf8"));
}

function installedVersion(name) {
  try {
    return readJson(join("node_modules", ...name.split("/"), "package.json")).version;
  } catch {
    return undefined;
  }
}

function detectPiVersion() {
  const command = process.platform === "win32" ? "pi.cmd" : "pi";
  try {
    const output = execFileSync(command, ["--version"], {
      encoding: "utf8",
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.match(/\b(\d+\.\d+\.\d+)\b/u)?.[1];
  } catch {
    return undefined;
  }
}

const devDependencies = readJson("package.json").devDependencies ?? {};
const failures = [];
let expectedTypebox;

for (const name of [...HOST_PACKAGES, "typebox"]) {
  const declared = devDependencies[name];
  if (typeof declared !== "string" || !EXACT_VERSION.test(declared)) {
    failures.push(`${name}: devDependencies 必须是精确版本，当前为 ${JSON.stringify(declared)}`);
    continue;
  }
  const installed = installedVersion(name);
  if (installed !== declared) {
    failures.push(`${name}: 声明 ${declared}，实际安装 ${installed ?? "未安装"}`);
  }
}

const piVersion = detectPiVersion();
if (piVersion === undefined) {
  console.warn("check-pi-version: 未找到 pi 命令，跳过运行时版本检查");
} else {
  for (const name of HOST_PACKAGES) {
    const installed = installedVersion(name);
    if (installed !== piVersion) {
      failures.push(`${name}: 安装 ${installed ?? "未安装"}，pi 运行时 ${piVersion}`);
    }
  }

  const pinnedTypebox = installedVersion("@earendil-works/pi-coding-agent");
  if (pinnedTypebox === piVersion) {
    const piManifest = readJson(
      join("node_modules", "@earendil-works", "pi-coding-agent", "package.json"),
    );
    expectedTypebox = piManifest.dependencies?.typebox;
    if (typeof expectedTypebox === "string") {
      if (devDependencies.typebox !== expectedTypebox) {
        failures.push(
          `typebox: devDependencies 声明 ${devDependencies.typebox}，pi 固定 ${expectedTypebox}`,
        );
      }
      if (installedVersion("typebox") !== expectedTypebox) {
        failures.push(
          `typebox: 实际安装 ${installedVersion("typebox") ?? "未安装"}，pi 固定 ${expectedTypebox}`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error("check-pi-version: 发现版本漂移");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  if (piVersion !== undefined) {
    const suggestion = HOST_PACKAGES.map((name) => `${name}@${piVersion}`).join(" ");
    const typeboxPart = expectedTypebox === undefined ? "" : ` typebox@${expectedTypebox}`;
    console.error(`修复：pnpm add -D -E ${suggestion}${typeboxPart}`);
  }
  process.exitCode = 1;
} else if (piVersion === undefined) {
  console.log("check-pi-version: devDependencies 与本地安装一致（跳过运行时检查）");
} else {
  console.log(`check-pi-version: pi ${piVersion}, typebox ${devDependencies.typebox} — ok`);
}
