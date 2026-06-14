#!/usr/bin/env node
/**
 * codex-hook install — 把 hook 注册到 Codex CLI
 *
 * ⚠️ Codex Hooks 在 feature-flag 后, 具体注册方式以 Codex 版本为准。
 * 本脚本尝试写入 ~/.codex/config.json 的 hooks 字段(以社区通用写法)。
 * 如不生效, 请手动按 `codex /hooks` 命令的提示注册。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK_SCRIPT = path.resolve(__dirname, 'hook.js');

function main() {
  const configPath = path.join(os.homedir(), '.codex', 'config.json');

  let config = {};
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch {
    console.warn('现有 config.json 损坏, 将覆盖');
  }

  config.hooks = config.hooks || {};
  config.hooks['pre-tool-use'] = config.hooks['pre-tool-use'] || [];

  const exists = config.hooks['pre-tool-use'].some(
    (h) => h.command && h.command.includes(HOOK_SCRIPT)
  );
  if (exists) {
    console.log('已注册, 跳过:', configPath);
    return;
  }

  config.hooks['pre-tool-use'].push({
    tool: 'Bash',
    command: `node "${HOOK_SCRIPT}"`,
  });

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

  console.log('✓ FileGuard hook 已写入:', configPath);
  console.log('⚠️  注意: Codex Hooks 在 feature-flag 后, 如未生效:');
  console.log('   1. 确认你的 Codex 版本支持 hooks (codex /hooks 命令应可用)');
  console.log('   2. 开启 feature flag (参考 Codex 官方文档)');
  console.log('   3. 或改用 codex /hooks add 命令手动注册');
  console.log('');
  console.log('⚠️  Codex 仅拦 Bash, 非删除路径需 fs-watchdog 兜底');
}

main();
