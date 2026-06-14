#!/usr/bin/env node
/**
 * fg — FileGuard 命令行
 *
 * 用法:
 *   fg lock <file> [--operator X] [--agent cli] [--desc "..."]
 *   fg unlock <file>
 *   fg list                          列出当前项目所有锁
 *   fg check <file>                  检查文件能否删(exit 0 可删, 1 锁定)
 *   fg release-all [--operator X]    释放本 operator 全部锁
 *   fg cleanup                       清理过期锁
 *   fg watch [projectRoot]           启动 watchdog(供 fs-watchdog 调)
 *
 * 给 hook 用的关键命令:
 *   fg check <file>   ← claude-hook / codex-hook 在删前调用
 *                       exit 0 = 可删, exit 1 = 锁定(stderr 给原因)
 */

import * as path from 'path';
import { LockStore, createStoreForFile } from './store';
import { hashProject } from './paths';
import { AuditLogger, TrustLevel } from './audit';
import { getAgentTrust } from './agentTrust';
import { FileRecord, LockSource } from './types';
import { AgentKind } from './types';

function fatal(msg: string, code = 2): never {
  console.error(`fg: ${msg}`);
  process.exit(code);
}

/** 找到文件对应的项目根, 没有就 fatal */
function mustGetProject(filePath: string): { store: LockStore; projectRoot: string } {
  const r = createStoreForFile(filePath);
  if (!r) fatal(`无法定位项目根(向上找不到 .git 或 package.json): ${filePath}`);
  return r;
}

function parseAgent(s: string | undefined): AgentKind {
  const valid: AgentKind[] = ['vscode', 'claude', 'codex', 'zcode', 'cli', 'other'];
  if (!s) return 'cli';
  if (valid.includes(s as AgentKind)) return s as AgentKind;
  fatal(`--agent 必须是: ${valid.join(', ')}`);
}

function fmtRecord(r: FileRecord): string {
  const since = new Date(r.timestamp).toLocaleString();
  const rel = r.relPath || r.filePath;
  return `${rel}\n    operator: ${r.operator}  agent: ${r.agent}  source: ${r.source}  since: ${since}${r.desc ? '  ' + r.desc : ''}`;
}

function main(): void {
  const [, , cmd, ...rest] = process.argv;

  if (!cmd) {
    console.log(`FileGuard (fg) — 跨工具防误删守卫

用法:
  fg lock <file> [--operator X] [--agent cli] [--desc "..."]
  fg unlock <file> [--agent cli]
  fg list [projectRoot]
  fg check <file> [--agent cli] [--operator Y]   检查能否删(exit 0 可删, 1 拦截)
  fg release-all <projectRoot> [--operator X]
  fg cleanup [projectRoot]
  fg watch [projectRoot]

  fg agent list                              列出所有 agent 及信任等级
  fg agent add <name> [--trust trusted]      登记 agent
  fg agent set-trust <name> <level>          设置信任(trusted|normal|untrusted|unknown)
  fg agent remove <name>                     移除 agent

  fg log [projectRoot] [--tail] [--limit 50] 查看审计日志

退出码:
  check: 0 = 可删, 1 = 锁定/拦截, 2 = 参数错误

信任等级(策略: unknown/untrusted 默认拦):
  trusted   可信 — 删锁文件放行
  normal    普通 — 拦截, 需确认
  untrusted 不可信 — 拒绝
  unknown   未登记 — 默认拦(保守)`);
    return;
  }

  switch (cmd) {
    case 'lock': {
      const file = rest[0];
      if (!file) fatal('缺少 <file> 参数');
      const abs = path.resolve(file);
      const { store, projectRoot } = mustGetProject(abs);
      const operator = getFlag(rest, '--operator') || process.env.USER || process.env.USERNAME || 'unknown';
      const agent = parseAgent(getFlag(rest, '--agent'));
      const desc = getFlag(rest, '--desc');
      store.lock(abs, {
        operator,
        agent,
        source: LockSource.EXPLICIT,
        desc,
        relPath: path.relative(projectRoot, abs),
      });
      console.log(`fg: 已锁 ${path.relative(projectRoot, abs)}`);
      break;
    }
    case 'unlock': {
      const file = rest[0];
      if (!file) fatal('缺少 <file> 参数');
      const abs = path.resolve(file);
      const { store, projectRoot } = mustGetProject(abs);
      const byOperator = getFlag(rest, '--agent') || getFlag(rest, '--operator');
      const had = store.release(abs, byOperator);
      console.log(had ? `fg: 已解锁 ${path.relative(projectRoot, abs)}` : `fg: 未锁定`);
      break;
    }
    case 'list': {
      const root = rest[0] ? path.resolve(rest[0]) : process.cwd();
      const store = new LockStore(root);
      const all = store.all();
      if (all.length === 0) {
        console.log('fg: 当前项目无锁');
      } else {
        console.log(`fg: ${all.length} 把锁 (project: ${hashProject(root)})`);
        all.sort((a, b) => b.timestamp - a.timestamp).forEach(r => {
          console.log('• ' + fmtRecord(r));
        });
      }
      break;
    }
    case 'check': {
      // hook 关键命令: exit 0 可删, exit 1 锁定/拦截
      const file = rest[0];
      if (!file) fatal('缺少 <file> 参数');
      const abs = path.resolve(file);
      const r = createStoreForFile(abs);
      if (!r) {
        // 找不到项目根 — 视为可删(不属于任何受保护项目)
        process.exit(0);
      }
      // agent 名: --agent 指定, 否则用 --operator, 默认 'cli'
      const agentName = getFlag(rest, '--agent') || getFlag(rest, '--operator') || 'cli';
      const decision = r.store.checkDelete(abs, agentName);
      if (decision.allow) {
        process.exit(0);
      }
      // 拦截: stderr 给原因(feedback 给 agent)
      console.error(`fg: BLOCKED — ${path.relative(r.projectRoot, abs)} 被 ${decision.owner} 锁定`);
      console.error(`  trust: ${decision.trust}  reason: ${decision.reason}`);
      console.error(`  如需删除: fg agent set-trust ${agentName} trusted  (信任此 agent)`);
      console.error(`  或释放锁: fg unlock ${file}`);
      process.exit(1);
    }
    case 'release-all': {
      const root = rest[0] ? path.resolve(rest[0]) : process.cwd();
      const operator = getFlag(rest, '--operator');
      const store = new LockStore(root);
      const n = store.releaseByOwner(operator);
      console.log(`fg: 释放 ${n} 把锁`);
      break;
    }
    case 'cleanup': {
      const root = rest[0] ? path.resolve(rest[0]) : process.cwd();
      const store = new LockStore(root);
      const n = store.cleanup();
      console.log(`fg: 清理 ${n} 把过期锁`);
      break;
    }
    case 'agent': {
      // 信任管理命令组
      const sub = rest[0];
      const trust = getAgentTrust();
      const validLevels: TrustLevel[] = ['trusted', 'normal', 'untrusted', 'unknown'];

      if (sub === 'list') {
        const list = trust.list();
        if (list.length === 0) {
          console.log('fg: 尚无登记的 agent');
        } else {
          console.log(`fg: ${list.length} 个 agent`);
          for (const a of list) {
            const tag = a.trust === 'trusted' ? '✓' : a.trust === 'untrusted' ? '✗' : a.trust === 'unknown' ? '?' : '~';
            console.log(`  ${tag} ${a.name}  [${a.trust}]${a.note ? '  ' + a.note : ''}`);
          }
        }
        break;
      }
      if (sub === 'add') {
        const name = rest[1];
        if (!name) fatal('缺少 <name> 参数');
        const level = (getFlag(rest, '--trust') as TrustLevel) || 'unknown';
        if (!validLevels.includes(level)) fatal(`--trust 必须是: ${validLevels.join(', ')}`);
        const note = getFlag(rest, '--note');
        trust.set(name, level, note);
        // 审计信任变更(全局, 不属于特定项目, 记到一个标记项目)
        console.log(`fg: 已登记 agent ${name} [${level}]`);
        break;
      }
      if (sub === 'set-trust') {
        const name = rest[1];
        const level = rest[2] as TrustLevel;
        if (!name || !level) fatal('用法: fg agent set-trust <name> <level>');
        if (!validLevels.includes(level)) fatal(`level 必须是: ${validLevels.join(', ')}`);
        trust.set(name, level);
        console.log(`fg: ${name} 信任等级 → ${level}`);
        break;
      }
      if (sub === 'remove') {
        const name = rest[1];
        if (!name) fatal('缺少 <name> 参数');
        const had = trust.remove(name);
        console.log(had ? `fg: 已移除 agent ${name}` : `fg: 未找到 agent ${name}`);
        break;
      }
      fatal(`fg agent 子命令: list | add | set-trust | remove`);
    }
    case 'log': {
      // 审计日志
      const root = rest[0] && !rest[0].startsWith('-') ? path.resolve(rest[0]) : process.cwd();
      const tail = rest.includes('--tail');
      const limitStr = getFlag(rest, '--limit');
      const limit = limitStr ? parseInt(limitStr, 10) || 50 : 50;
      const logger = AuditLogger.for(root);
      const entries = logger.recent(limit);

      if (entries.length === 0) {
        console.log('fg: 无审计日志');
        break;
      }

      const eventIcon: Record<string, string> = {
        lock: '🔒', unlock: '🔓', block: '🚫', restore: '♻️',
        'restore-failed': '⚠️', 'force-delete': '💥', 'trust-change': '🔧', expire: '⏰',
      };

      console.log(`fg: ${entries.length} 条日志 (limit=${limit})`);
      for (const e of entries) {
        const icon = eventIcon[e.event] || '•';
        const time = e.ts.replace('T', ' ').replace(/\..*/, '');
        const rel = e.relPath || (e.filePath || '').split(/[\\/]/).pop() || '';
        console.log(`${icon} ${time}  ${e.event.padEnd(14)}  ${rel}`);
        console.log(`     operator: ${e.operator}  agent: ${e.agent || '-'}  trust: ${e.trust || '-'}`);
        if (e.detail) console.log(`     ${e.detail}`);
      }
      if (tail) {
        console.log('\n(日志文件: ' + logger.getPath() + ')');
      }
      break;
    }
    default:
      fatal(`未知命令: ${cmd}`);
  }
}

/** 解析 --flag value */
function getFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

main();
