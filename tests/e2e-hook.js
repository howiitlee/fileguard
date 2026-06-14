// 端到端验证 — claude-hook / codex-hook 的删除拦截
// 自包含: 临时项目 + 自清理
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FG = path.resolve(__dirname, '..', 'packages', 'cli-shared', 'out', 'cli.js');
const CLAUDE_HOOK = path.resolve(__dirname, '..', 'packages', 'claude-hook', 'hook.js');
const CODEX_HOOK = path.resolve(__dirname, '..', 'packages', 'codex-hook', 'hook.js');

// 建临时项目
const TEST_DIR = path.join(os.tmpdir(), 'fg-hook-test-' + Date.now());
fs.mkdirSync(TEST_DIR, { recursive: true });
const LOCKED = path.join(TEST_DIR, 'locked.ts');
const FREE = path.join(TEST_DIR, 'free.ts');
fs.writeFileSync(LOCKED, 'locked\n');
fs.writeFileSync(FREE, 'free\n');
spawnSync('git', ['init', '-q'], { cwd: TEST_DIR });
spawnSync('git', ['config', 'user.email', 't@t'], { cwd: TEST_DIR });
spawnSync('git', ['config', 'user.name', 't'], { cwd: TEST_DIR });
spawnSync('git', ['add', '-A'], { cwd: TEST_DIR });
spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: TEST_DIR });

// 用 zcode 锁住 locked.ts (这样 claude 和 codex 删它都不是自己锁的, 都该被拦)
spawnSync('node', [FG, 'lock', LOCKED, '--operator', 'zcode', '--agent', 'zcode'], { encoding: 'utf8', cwd: TEST_DIR });

function runHook(hookPath, payload) {
  return spawnSync('node', [hookPath], { input: JSON.stringify(payload), encoding: 'utf8' });
}

let pass = 0, fail = 0;
function check(name, cond) {
  console.log((cond ? '✓ PASS' : '✗ FAIL') + ': ' + name);
  cond ? pass++ : fail++;
}

console.log('=== claude-hook: 删已锁文件 (期望 exit=2) ===');
let r = runHook(CLAUDE_HOOK, { tool_name: 'Bash', tool_input: { command: `rm ${LOCKED}` } });
check('已锁文件被拦截', r.status === 2);
console.log('  ' + r.stderr.trim().split('\n')[0]);

console.log('\n=== claude-hook: 删未锁文件 (期望 exit=0) ===');
r = runHook(CLAUDE_HOOK, { tool_name: 'Bash', tool_input: { command: `rm ${FREE}` } });
check('未锁文件放行', r.status === 0);

console.log('\n=== claude-hook: 非 Bash 工具 (期望 exit=0) ===');
r = runHook(CLAUDE_HOOK, { tool_name: 'Read', tool_input: { command: 'cat x' } });
check('非 Bash 放行', r.status === 0);

console.log('\n=== claude-hook: PowerShell Remove-Item 已锁 (期望 exit=2) ===');
r = runHook(CLAUDE_HOOK, { tool_name: 'Bash', tool_input: { command: `Remove-Item ${LOCKED}` } });
check('PowerShell 删除被拦截', r.status === 2);

console.log('\n=== codex-hook: 删已锁文件 (期望 exit=2) ===');
r = runHook(CODEX_HOOK, { tool_name: 'Bash', tool_input: { command: `rm ${LOCKED}` } });
check('codex 已锁文件被拦截', r.status === 2);

console.log('\n=== codex-hook: 非删除命令 (期望 exit=0) ===');
r = runHook(CODEX_HOOK, { tool_name: 'Bash', tool_input: { command: `ls ${TEST_DIR}` } });
check('codex 非删除放行', r.status === 0);

console.log(`\n=== 结果: ${pass} PASS / ${fail} FAIL ===`);

// 清理
try {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  const { hashProject } = require(path.resolve(__dirname, '..', 'packages', 'cli-shared', 'out', 'paths.js'));
  fs.rmSync(path.join(os.homedir(), '.fileguard', 'projects', hashProject(TEST_DIR)), { recursive: true, force: true });
} catch { /* ignore */ }
process.exit(fail > 0 ? 1 : 0);
