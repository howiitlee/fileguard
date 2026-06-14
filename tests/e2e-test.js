// 端到端验证 — fg 命令核心能力(锁/查/拦截/解锁)
// 自包含: 临时项目 + 自清理, 不依赖外部固定路径
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FG = path.resolve(__dirname, '..', 'packages', 'cli-shared', 'out', 'cli.js');

// 建临时项目
const TEST_DIR = path.join(os.tmpdir(), 'fg-cli-test-' + Date.now());
fs.mkdirSync(TEST_DIR, { recursive: true });
const FILE_A = path.join(TEST_DIR, 'a.ts');
const FILE_B = path.join(TEST_DIR, 'b.ts');
fs.writeFileSync(FILE_A, 'a content\n');
fs.writeFileSync(FILE_B, 'b content\n');
spawnSync('git', ['init', '-q'], { cwd: TEST_DIR });
spawnSync('git', ['config', 'user.email', 't@t'], { cwd: TEST_DIR });
spawnSync('git', ['config', 'user.name', 't'], { cwd: TEST_DIR });
spawnSync('git', ['add', '-A'], { cwd: TEST_DIR });
spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: TEST_DIR });

function run(args) {
  return spawnSync('node', [FG, ...args], { encoding: 'utf8', cwd: TEST_DIR });
}

let pass = 0, fail = 0;
function check(name, cond) {
  console.log((cond ? '✓ PASS' : '✗ FAIL') + ': ' + name);
  cond ? pass++ : fail++;
}

console.log('=== 1. fg lock a.ts ===');
let r = run(['lock', FILE_A, '--operator', 'codex', '--agent', 'codex']);
console.log('  ' + r.stdout.trim());
check('lock 成功', r.status === 0);

console.log('\n=== 2. fg check a.ts (已锁, 期望 exit=1) ===');
r = run(['check', FILE_A, '--agent', 'claude']);
console.log('  exit=' + r.status);
check('已锁文件被拦截', r.status === 1);

console.log('\n=== 3. fg check b.ts (未锁, 期望 exit=0) ===');
r = run(['check', FILE_B, '--agent', 'claude']);
console.log('  exit=' + r.status);
check('未锁文件放行', r.status === 0);

console.log('\n=== 4. fg list ===');
r = run(['list', TEST_DIR]);
console.log(r.stdout);
check('list 显示锁', r.stdout.includes('a.ts'));

console.log('\n=== 5. fg unlock a.ts ===');
r = run(['unlock', FILE_A, '--agent', 'codex']);
console.log('  ' + r.stdout.trim());
check('unlock 成功', r.status === 0);

console.log('\n=== 6. fg check a.ts (解锁后, 期望 exit=0) ===');
r = run(['check', FILE_A, '--agent', 'claude']);
console.log('  exit=' + r.status);
check('解锁后放行', r.status === 0);

console.log('\n=== 7. fg cleanup ===');
run(['lock', FILE_A, '--operator', 'x', '--agent', 'cli']);
r = run(['cleanup', TEST_DIR]);
console.log('  ' + r.stdout.trim());
check('cleanup 成功', r.status === 0);

console.log(`\n=== 结果: ${pass} PASS / ${fail} FAIL ===`);

// 清理
try {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  const { hashProject } = require(path.resolve(__dirname, '..', 'packages', 'cli-shared', 'out', 'paths.js'));
  fs.rmSync(path.join(os.homedir(), '.fileguard', 'projects', hashProject(TEST_DIR)), { recursive: true, force: true });
} catch { /* ignore */ }
process.exit(fail > 0 ? 1 : 0);
