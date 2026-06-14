#!/usr/bin/env node
/**
 * claude-hook install — 把 hook 注册到 ~/.claude/settings.json
 *
 * 用法: node install.js
 *   (默认注册到用户级 ~/.claude/settings.json)
 *   node install.js --project  (注册到当前项目 .claude/settings.json)
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK_SCRIPT = path.resolve(__dirname, 'hook.js');

function getSettingsPath(projectScope) {
  if (projectScope) {
    return path.join(process.cwd(), '.claude', 'settings.json');
  }
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function main() {
  const projectScope = process.argv.includes('--project');
  const settingsPath = getSettingsPath(projectScope);

  // 读现有 settings
  let settings = {};
  try {
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch {
    console.warn('现有 settings.json 损坏, 将覆盖');
  }

  settings.hooks = settings.hooks || {};
  settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];

  // 检查是否已注册
  const exists = settings.hooks.PreToolUse.some(
    (h) => h.hooks && h.hooks.some((x) => x.command && x.command.includes(HOOK_SCRIPT))
  );
  if (exists) {
    console.log('已注册, 跳过:', settingsPath);
    return;
  }

  settings.hooks.PreToolUse.push({
    matcher: 'Bash|Write|Edit',
    hooks: [{ type: 'command', command: `node "${HOOK_SCRIPT}"` }],
  });

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

  console.log('✓ FileGuard hook 已注册:', settingsPath);
  console.log('  匹配工具: Bash / Write / Edit');
  console.log('  脚本:', HOOK_SCRIPT);
  if (projectScope) {
    console.log('  作用域: 当前项目');
  } else {
    console.log('  作用域: 全局(所有项目)');
  }
}

main();
