#!/usr/bin/env node
/**
 * claude-hook — Claude Code 的 FileGuard PreToolUse 拦截器
 *
 * 纯 JS, 不经 TS 编译(hook 必须能被 Claude Code 直接 node 起来)。
 * 依赖 cli-shared 的 out/(已编译产物)。
 *
 * 配置(写入 ~/.claude/settings.json):
 *   {
 *     "hooks": {
 *       "PreToolUse": [{
 *         "matcher": "Bash|Write|Edit",
 *         "hooks": [{ "type": "command",
 *                     "command": "node /abs/path/to/claude-hook/hook.js" }]
 *       }]
 *     }
 *   }
 *
 * 行为:
 *   exit 0  → 放行
 *   exit 2  → 阻断, stderr 反馈给模型
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// 解析 cli-shared 的编译产物路径(同 monorepo 兄弟包)
const CLI_SHARED = path.resolve(__dirname, '..', 'cli-shared', 'out');
let shared;
try {
  shared = require(path.join(CLI_SHARED, 'index.js'));
} catch (e) {
  // cli-shared 没编译 → 放行, 不阻塞工作流(但记日志)
  console.error('[FileGuard] cli-shared 未编译, hook 跳过. 请在 @fileguard/cli-shared 跑 npm run build');
  process.exit(0);
}

const { findProjectRoot, LockStore } = shared;

function block(msg) {
  console.error('[FileGuard] BLOCKED: ' + msg);
  process.exit(2);
}

/** 从 Bash 命令里提取被删文件路径 */
function extractDeleteTargets(command) {
  const targets = [];
  const patterns = [
    /\brm\b(?:\s+-[a-zA-Z]+)*\s+([^\s|;&]+)/g,    // rm
    /\bdel\b\s+([^\s|;&]+)/gi,                     // del (Windows)
    /Remove-Item\s+(?:-Path\s+)?([^\s|;&]+)/gi,    // PowerShell
    /\bgit\s+rm\b(?:\s+-[a-zA-Z]+)*\s+([^\s|;&]+)/g, // git rm
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(command)) !== null) {
      const tok = m[1];
      if (tok && !tok.startsWith('-') && !tok.startsWith('/')) {
        targets.push(tok);
      }
    }
  }
  return targets;
}

function checkFileLocked(filePath) {
  const abs = path.resolve(filePath);
  const root = findProjectRoot(abs);
  if (!root) return { locked: false };
  const store = new LockStore(root);
  // 用 checkDelete 走信任决策: trusted agent 删锁文件放行
  const decision = store.checkDelete(abs, 'claude');
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
    process.exit(0); // 协议异常, 放行
    return;
  }

  const toolName = payload.tool_name;
  const input = payload.tool_input || {};

  const filesToCheck = [];
  if (toolName === 'Bash' && input.command) {
    filesToCheck.push(...extractDeleteTargets(input.command));
  } else if ((toolName === 'Write' || toolName === 'Edit') && input.file_path) {
    filesToCheck.push(input.file_path);
  } else {
    process.exit(0);
    return;
  }

  for (const f of filesToCheck) {
    const result = checkFileLocked(f);
    if (result.locked) {
      block(`${result.rel} 被 ${result.owner} 锁定 [trust: ${result.trust}]。${result.reason}。如需删除: fg agent set-trust claude trusted, 或 fg unlock ${f}`);
    }
  }

  process.exit(0);
}

main();
