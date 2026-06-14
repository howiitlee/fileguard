// 验证信任分级 + 审计日志(端到端)
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FG = path.resolve(__dirname, '..', 'packages', 'cli-shared', 'out', 'cli.js');
const CLAUDE_HOOK = path.resolve(__dirname, '..', 'packages', 'claude-hook', 'hook.js');

// 测试项目
const TEST_DIR = path.join(os.tmpdir(), 'fg-trust-test-' + Date.now());
fs.mkdirSync(TEST_DIR, { recursive: true });
const TEST_FILE = path.join(TEST_DIR, 'secret.ts');
fs.writeFileSync(TEST_FILE, 'secret code\n');
// git init 让它成为受保护项目
spawnSync('git', ['init', '-q'], { cwd: TEST_DIR });
spawnSync('git', ['config', 'user.email', 't@t'], { cwd: TEST_DIR });
spawnSync('git', ['config', 'user.name', 't'], { cwd: TEST_DIR });
spawnSync('git', ['add', '-A'], { cwd: TEST_DIR });
spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: TEST_DIR });

function run(args, opts = {}) {
  return spawnSync('node', [FG, ...args], { encoding: 'utf8', cwd: TEST_DIR, ...opts });
}
function runHook(payload) {
  return spawnSync('node', [CLAUDE_HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });
}

let pass = 0, fail = 0;
function check(name, cond) {
  console.log((cond ? '✓ PASS' : '✗ FAIL') + ': ' + name);
  cond ? pass++ : fail++;
}

console.log('=== 准备: 用 codex 锁文件 ===');
const lockR = run(['lock', TEST_FILE, '--operator', 'codex', '--agent', 'codex', '--desc', 'codex占用']);
console.log('  lock status:', lockR.status, 'stdout:', JSON.stringify(lockR.stdout), 'stderr:', lockR.stderr);
if (lockR.status !== 0) {
  console.log('!! lock 失败, 测试中止');
  console.log('TEST_DIR:', TEST_DIR, '存在:', fs.existsSync(TEST_DIR));
  console.log('.git 存在:', fs.existsSync(path.join(TEST_DIR, '.git')));
  process.exit(1);
}

console.log('\n=== 1. claude-hook 删已锁文件, claude 是 unknown (期望 exit=2 拦截) ===');
let r = runHook({ tool_name: 'Bash', tool_input: { command: `rm ${TEST_FILE}` } });
check('unknown claude 被拦截', r.status === 2);
console.log('  stderr:', r.stderr.trim().split('\n')[0]);

console.log('\n=== 2. 把 claude 设为 trusted ===');
r = run(['agent', 'set-trust', 'claude', 'trusted']);
console.log('  ' + r.stdout.trim());

console.log('\n=== 3. claude-hook 删已锁文件, claude 现在是 trusted (期望 exit=0 放行) ===');
r = runHook({ tool_name: 'Bash', tool_input: { command: `rm ${TEST_FILE}` } });
check('trusted claude 放行', r.status === 0);

console.log('\n=== 4. 把 claude 设回 untrusted, 再删 (期望 exit=2) ===');
run(['agent', 'set-trust', 'claude', 'untrusted']);
r = runHook({ tool_name: 'Bash', tool_input: { command: `rm ${TEST_FILE}` } });
check('untrusted claude 拦截', r.status === 2);

console.log('\n=== 5. 查审计日志(应有 block/lock 记录) ===');
r = run(['log', TEST_DIR, '--limit', '20']);
console.log(r.stdout);
const hasBlock = r.stdout.includes('block');
check('审计日志含 block 事件', hasBlock);

console.log('\n=== 6. 查 agent 列表 ===');
r = run(['agent', 'list']);
console.log(r.stdout);
check('agent 列表含 claude', r.stdout.includes('claude'));

console.log(`\n=== 结果: ${pass} PASS / ${fail} FAIL ===`);

// 清理
try {
  spawnSync('git', ['rm', '-q', '-f', '--cached', '.'], { cwd: TEST_DIR });
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  // 清理注册表里的测试项目
  const { hashProject } = require(path.resolve(__dirname, '..', 'packages', 'cli-shared', 'out', 'paths.js'));
  const h = hashProject(TEST_DIR);
  const regDir = path.join(os.homedir(), '.fileguard', 'projects', h);
  fs.rmSync(regDir, { recursive: true, force: true });
} catch { /* ignore */ }

process.exit(fail > 0 ? 1 : 0);
