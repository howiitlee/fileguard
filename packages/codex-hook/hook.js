#!/usr/bin/env node
/**
 * codex-hook — OpenAI Codex CLI 的 FileGuard 拦截器
 *
 * ⚠️ 重要限制(基于可行性核查):
 *   Codex Hooks 当前在 feature-flag 后, 且仅拦截 Bash 工具。
 *   非 Bash 删除(如未来的 file-delete 工具)拦不住 → 需 fs-watchdog 兜底。
 *
 * 协议(与 Claude Code 类似):
 *   - stdin 收 JSON
 *   - exit 2 阻断, stderr 反馈
 *
 * 注册(参考 OpenAI Codex hooks 文档):
 *   codex /hooks add pre-tool-use --command "node /abs/path/to/hook.js"
 *   或手动编辑 ~/.codex/config.json (具体字段名以 Codex 版本为准)
 *
 * 纯 JS, 不经 TS 编译。
 */

'use strict';

const path = require('path');
const fs = require('fs');

const CLI_SHARED = path.resolve(__dirname, '..', 'cli-shared', 'out');
let shared;
try {
  shared = require(path.join(CLI_SHARED, 'index.js'));
} catch {
  console.error('[FileGuard] cli-shared 未编译, hook 跳过');
  process.exit(0);
}

const { findProjectRoot, LockStore } = shared;

function block(msg) {
  console.error('[FileGuard] BLOCKED: ' + msg);
  process.exit(2);
}

function extractDeleteTargets(command) {
  const targets = [];
  const patterns = [
    /\brm\b(?:\s+-[a-zA-Z]+)*\s+([^\s|;&]+)/g,
    /\bdel\b\s+([^\s|;&]+)/gi,
    /Remove-Item\s+(?:-Path\s+)?([^\s|;&]+)/gi,
    /\bgit\s+rm\b(?:\s+-[a-zA-Z]+)*\s+([^\s|;&]+)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(command)) !== null) {
      const tok = m[1];
      if (tok && !tok.startsWith('-') && !tok.startsWith('/')) targets.push(tok);
    }
  }
  return targets;
}

function checkFileLocked(filePath) {
  const abs = path.resolve(filePath);
  const root = findProjectRoot(abs);
  if (!root) return { locked: false };
  const store = new LockStore(root);
  const decision = store.checkDelete(abs, 'codex');
  if (!decision.allow) {
    return {
      locked: true,
      owner: decision.owner,
      rel: path.relative(root, abs),
      trust: decision.trust,
      reason: decision.reason,
    };
  }
  return { locked: false };
}

function main() {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    process.exit(0);
    return;
  }

  // Codex 的 payload 字段名可能因版本而异, 兼容几种写法
  const toolName = payload.tool_name || payload.toolName || payload.name;
  const input = payload.tool_input || payload.input || {};
  const command = input.command || payload.command;

  // Codex 当前主要拦 Bash
  if (toolName !== 'Bash' && toolName !== 'shell' && !command) {
    process.exit(0);
    return;
  }

  const filesToCheck = extractDeleteTargets(command || '');
  for (const f of filesToCheck) {
    const result = checkFileLocked(f);
    if (result.locked) {
      block(`${result.rel} 被 ${result.owner} 锁定 [trust: ${result.trust}]。${result.reason}。如需删除: fg agent set-trust codex trusted, 或 fg unlock ${f}`);
    }
  }

  process.exit(0);
}

main();
