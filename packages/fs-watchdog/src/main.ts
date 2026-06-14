/**
 * fs-watchdog — FileGuard 兜底守护进程
 *
 * 工作原理(诚实说明):
 *   chokidar 的 unlink 是"文件已删"的**事后**事件, 无法真正阻止删除。
 *   所以 watchdog 的"拦截"实际是"删后秒级弹通知 + 用户选保留则从 git/备份恢复"。
 *   这是文件系统层面的物理事实, 任何工具都绕不开。
 *
 * 三道防线:
 *   1. 备份: 文件被锁的瞬间立即备份一份(供恢复)
 *   2. 监听: chokidar 监控 unlink, 命中锁定文件 → 弹通知
 *   3. 恢复: 用户选"保留" → 从 git/备份恢复
 *
 * 启动:
 *   fg-watchdog [projectRoot1] [projectRoot2] ...
 *   不传参数则监控 ~/.fileguard/registry.json 里登记的所有项目
 */

import * as path from 'path';
import * as chokidar from 'chokidar';
import { LockStore } from '@fileguard/cli-shared';
import { backupFile, restoreFile } from '@fileguard/cli-shared';
import { AuditLogger } from '@fileguard/cli-shared';
import { notifyInfo, logEvent } from './notifier';

interface WatchTarget {
  projectRoot: string;
  store: LockStore;
  watcher: chokidar.FSWatcher;
}

const targets = new Map<string, WatchTarget>();

/** 监控一个项目 */
function watchProject(projectRoot: string): WatchTarget | null {
  const absRoot = path.resolve(projectRoot);
  if (targets.has(absRoot)) return targets.get(absRoot)!;

  const store = new LockStore(absRoot);

  // 给当前所有锁对应的文件做一次备份
  for (const r of store.all()) {
    backupFile(absRoot, r.filePath);
  }

  // 监听整个项目目录的删除
  const watcher = chokidar.watch(absRoot, {
    ignoreInitial: true,
    ignored: [
      '**/node_modules/**',
      '**/.git/objects/**',
      '**/out/**',
      '**/dist/**',
      '**/.fileguard/**',
    ],
    persistent: true,
    ignorePermissionErrors: true,
  });

  watcher.on('unlink', (fp) => {
    void onFileDeleted(absRoot, store, fp);
  });
  // 目录删除也监听
  watcher.on('unlinkDir', (dir) => {
    // 检查是否有锁定文件在此目录下
    for (const r of store.all()) {
      if (r.filePath.startsWith(dir.replace(/\\/g, '/') + '/')) {
        void onFileDeleted(absRoot, store, r.filePath);
      }
    }
  });

  const target: WatchTarget = { projectRoot: absRoot, store, watcher };
  targets.set(absRoot, target);
  logEvent(`监控启动: ${absRoot} (当前 ${store.all().length} 把锁)`);
  return target;
}

/** 文件被删事件 */
async function onFileDeleted(projectRoot: string, store: LockStore, filePath: string): Promise<void> {
  // 检查是否被锁
  const record = store.get(filePath);
  if (!record) return; // 没锁, 不管

  const rel = path.relative(projectRoot, filePath);
  logEvent(`检测到锁定文件被删: ${rel} (owner: ${record.operator})`);

  // watchdog 定位: 兜底, 立即恢复(不等用户)
  // 理由: 前置 hook(claude/codex/vscode)已经给了拦截机会,
  //       到了 watchdog 这层说明删除已经发生, 应果断恢复避免数据丢失。
  //       通知是告知性的(非阻塞), 用户若确实要删, 先 fg unlock 再重试。
  const r = restoreFile(projectRoot, filePath);
  const audit = AuditLogger.for(projectRoot);
  if (r.ok) {
    logEvent(`已恢复 ${rel} (via ${r.method})`);
    audit.log({
      event: 'restore',
      filePath,
      relPath: rel,
      operator: record.operator,
      agent: record.agent,
      detail: `删除被检测到, 经 ${r.method} 恢复`,
    });
    // 恢复后重新备份(供下次)
    backupFile(projectRoot, filePath);
    // 非阻塞通知(异步, 不影响监听)
    notifyRestoredAsync(rel, record.operator, r.method);
  } else {
    logEvent(`恢复失败 ${rel}: ${r.method} — 无法自动恢复`);
    audit.log({
      event: 'restore-failed',
      filePath,
      relPath: rel,
      operator: record.operator,
      agent: record.agent,
      detail: `${r.method}`,
    });
    notifyRestoreFailedAsync(rel, record.operator, r.method);
  }
}

/** 非阻塞"已恢复"通知 */
function notifyRestoredAsync(rel: string, owner: string, method: string): void {
  setImmediate(() => {
    try {
      notifyInfo(
        'FileGuard 已自动恢复',
        `${rel}\n被 ${owner} 锁定却被删除\n已从 ${method} 恢复\n如确实要删, 请先 fg unlock`
      );
    } catch {
      /* 通知失败不影响主流程 */
    }
  });
}

/** 非阻塞"恢复失败"通知 */
function notifyRestoreFailedAsync(rel: string, owner: string, reason: string): void {
  setImmediate(() => {
    try {
      notifyInfo(
        'FileGuard 恢复失败',
        `${rel}\n被 ${owner} 锁定后被删, 但 ${reason}\n请手动从 git 历史恢复`
      );
    } catch {
      /* ignore */
    }
  });
}

/** 优雅退出 */
async function shutdown(): Promise<void> {
  logEvent('正在关闭所有监控...');
  for (const [, t] of targets) {
    await t.watcher.close();
  }
  targets.clear();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/** 主入口 */
function main(): void {
  const roots = process.argv.slice(2);

  if (roots.length === 0) {
    // 无参数 → 监控当前目录
    roots.push(process.cwd());
    console.log('未指定项目根, 监控当前目录:', process.cwd());
  }

  console.log('FileGuard Watchdog 启动');
  console.log('监控项目:', roots.join(', '));
  console.log('按 Ctrl+C 退出\n');

  for (const root of roots) {
    const t = watchProject(root);
    if (!t) {
      console.error(`无法监控: ${root}`);
    }
  }

  // 每 10 分钟清理一次过期锁
  setInterval(() => {
    for (const [, t] of targets) {
      const n = t.store.cleanup();
      if (n > 0) logEvent(`清理 ${t.projectRoot} 的 ${n} 把过期锁`);
    }
  }, 10 * 60 * 1000);
}

main();
